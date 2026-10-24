// otel-metrics.ts：业务指标注册表——IPC / 启动 / 更新 / 事件循环 / 内存 / Web Vitals
// 边界：只持有 instrument 句柄并在 init 时注册 observable 回调；OTel 未初始化时所有 record* 为 no-op
// 命名遵循 OTel 语义约定（点分小写）：服务端指标用 ipc.* / process.* / nodejs.*，产品指标用 app.* / web_vitals.*

import type { WebVitalName } from '@code-agent/shared/main';
import {
  OBSERVABILITY_METRIC_DEFINITIONS,
  OBSERVABILITY_METRICS,
  type ObservabilityMetricName,
  WEB_VITAL_METRICS,
} from '@code-agent/shared/observability';
import type { Attributes, Counter, Histogram, Meter, ObservableGauge } from '@opentelemetry/api';
import { app } from 'electron';

/** 单次 IPC 请求结果（指标标签，基数有界） */
export type IpcOutcome = 'success' | 'error';

/** 保守分类避免将系统故障混入预期业务拒绝。 */
export type IpcFailureClass = 'none' | 'validation' | 'business' | 'system';

/** 保留调度来源，避免重试和长会话被误算为启动检查。 */
export type UpdateCheckTrigger = 'launch' | 'manual' | 'retry' | 'long-session';

/** 更新漏斗阶段（与 UpdateStatusPayload.phase 对齐） */
export type UpdateMetricPhase =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloaded'
  | 'cancelled'
  | 'error';

/** 数据库损坏自愈结局（healthy=原库健康 / restored=从备份恢复 / rebuilt=归档后重建空库） */
export type DbRecoveryOutcome = 'healthy' | 'restored' | 'rebuilt';

/** 数据库备份结局 */
export type DbBackupOutcome = 'success' | 'error';

// Electron 的 render-process-gone.reason 已有固定值域；未知值归入 unknown，防属性高基数
const RENDERER_CRASH_REASONS = new Set([
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
]);

interface MetricInstruments {
  readonly ipcRequests: Counter<Attributes>;
  readonly ipcDuration: Histogram<Attributes>;
  readonly startupDuration: Histogram<Attributes>;
  readonly updateEvents: Counter<Attributes>;
  readonly updateChecks: Counter<Attributes>;
  readonly updateCheckDuration: Histogram<Attributes>;
  readonly updateDownloadDuration: Histogram<Attributes>;
  readonly eventLoopDelay: Histogram<Attributes>;
  readonly memoryGrowth: Histogram<Attributes>;
  readonly dbRecovery: Counter<Attributes>;
  readonly dbBackup: Counter<Attributes>;
  readonly dbBackupDuration: Histogram<Attributes>;
  readonly rendererCrashes: Counter<Attributes>;
  readonly webVitals: Record<WebVitalName, Histogram<Attributes>>;
}

let instruments: MetricInstruments | null = null;

/** 把 Web Vitals 名字映射到独立 histogram（CLS 无量纲，其余毫秒） */
function createWebVitalInstruments(meter: Meter): Record<WebVitalName, Histogram<Attributes>> {
  const create = (name: ObservabilityMetricName): Histogram<Attributes> =>
    meter.createHistogram(name, {
      description: `Renderer Web Vital ${name.split('.').pop() ?? name}`,
      unit: OBSERVABILITY_METRIC_DEFINITIONS[name].unit,
    });
  return {
    ['CLS']: create(WEB_VITAL_METRICS.CLS),
    ['FCP']: create(WEB_VITAL_METRICS.FCP),
    ['INP']: create(WEB_VITAL_METRICS.INP),
    ['LCP']: create(WEB_VITAL_METRICS.LCP),
    ['TTFB']: create(WEB_VITAL_METRICS.TTFB),
  };
}

/** 注册进程级 observable gauge（内存 / 各 Electron 进程 CPU 与工作集） */
function registerProcessGauges(meter: Meter): void {
  const memoryGauge: ObservableGauge<Attributes> = meter.createObservableGauge(
    OBSERVABILITY_METRICS.processMemoryUsage,
    {
      description: 'Node.js process memory usage',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.processMemoryUsage].unit,
    },
  );
  memoryGauge.addCallback((result) => {
    const mem = process.memoryUsage();
    result.observe(mem.rss, { state: 'rss' });
    result.observe(mem.heapUsed, { state: 'heap_used' });
    result.observe(mem.heapTotal, { state: 'heap_total' });
    result.observe(mem.external, { state: 'external' });
    result.observe(mem.arrayBuffers, { state: 'array_buffers' });
  });

  const processMemoryGauge = meter.createObservableGauge(
    OBSERVABILITY_METRICS.electronProcessMemory,
    {
      description: 'Electron process working set (main / renderer / gpu / utility)',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.electronProcessMemory].unit,
    },
  );
  const processCpuGauge = meter.createObservableGauge(OBSERVABILITY_METRICS.electronProcessCpu, {
    description: 'Electron process CPU usage (0-100)',
    unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.electronProcessCpu].unit,
  });
  const observeProcesses = (result: {
    observe(value: number, attributes?: Attributes): void;
  }): void => {
    try {
      for (const proc of app.getAppMetrics()) {
        const attributes: Attributes = { 'process.type': proc.type };
        if (proc.name !== undefined) {
          attributes['process.name'] = proc.name;
        }
        result.observe(proc.memory.workingSetSize * 1024, attributes);
      }
    } catch {
      // app 未就绪/进程退出竞态：本轮跳过采集，不影响导出循环
    }
  };
  processMemoryGauge.addCallback(observeProcesses);
  processCpuGauge.addCallback((result) => {
    try {
      for (const proc of app.getAppMetrics()) {
        const attributes: Attributes = { 'process.type': proc.type };
        if (proc.name !== undefined) {
          attributes['process.name'] = proc.name;
        }
        result.observe(proc.cpu.percentCPUUsage, attributes);
      }
    } catch {
      // 同上：采集失败不抛出到导出器
    }
  });
}

/**
 * 初始化指标注册表（OTel metrics provider 就绪后调用一次）
 *
 * @param meter 已绑定 resource 的 meter
 */
export function initOtelMetrics(meter: Meter): void {
  instruments = {
    ipcRequests: meter.createCounter(OBSERVABILITY_METRICS.ipcRequests, {
      description: 'IPC request count by channel, outcome and failure class',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.ipcRequests].unit,
    }),
    ipcDuration: meter.createHistogram(OBSERVABILITY_METRICS.ipcRequestDuration, {
      description: 'IPC request duration by channel, outcome and failure class',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.ipcRequestDuration].unit,
    }),
    startupDuration: meter.createHistogram(OBSERVABILITY_METRICS.startupDuration, {
      description: 'Application startup duration by phase and mode',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.startupDuration].unit,
    }),
    updateEvents: meter.createCounter(OBSERVABILITY_METRICS.updateEvents, {
      description: 'Auto-update funnel events',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.updateEvents].unit,
    }),
    updateChecks: meter.createCounter(OBSERVABILITY_METRICS.updateChecks, {
      description: 'Completed update checks by trigger and outcome',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.updateChecks].unit,
    }),
    updateCheckDuration: meter.createHistogram(OBSERVABILITY_METRICS.updateCheckDuration, {
      description: 'Update check duration by trigger and outcome',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.updateCheckDuration].unit,
    }),
    updateDownloadDuration: meter.createHistogram(OBSERVABILITY_METRICS.updateDownloadDuration, {
      description: 'Update download duration by outcome',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.updateDownloadDuration].unit,
    }),
    eventLoopDelay: meter.createHistogram(OBSERVABILITY_METRICS.eventLoopDelay, {
      description: 'Distribution of main process event loop window p99 delays',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.eventLoopDelay].unit,
    }),
    memoryGrowth: meter.createHistogram(OBSERVABILITY_METRICS.memoryGrowth, {
      description: 'Detected RSS growth over a monotonic sampling window',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.memoryGrowth].unit,
    }),
    dbRecovery: meter.createCounter(OBSERVABILITY_METRICS.dbRecovery, {
      description: 'Database corruption recovery outcomes',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.dbRecovery].unit,
    }),
    dbBackup: meter.createCounter(OBSERVABILITY_METRICS.dbBackup, {
      description: 'Database backup outcomes',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.dbBackup].unit,
    }),
    dbBackupDuration: meter.createHistogram(OBSERVABILITY_METRICS.dbBackupDuration, {
      description: 'Database backup duration by outcome',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.dbBackupDuration].unit,
    }),
    rendererCrashes: meter.createCounter(OBSERVABILITY_METRICS.rendererCrashes, {
      description: 'Renderer process crashes by reason and recovery',
      unit: OBSERVABILITY_METRIC_DEFINITIONS[OBSERVABILITY_METRICS.rendererCrashes].unit,
    }),
    webVitals: createWebVitalInstruments(meter),
  };
  registerProcessGauges(meter);
}

/** 清空 instrument 句柄（provider shutdown 后调用，防回调被回收后仍被引用） */
export function resetOtelMetrics(): void {
  instruments = null;
}

/** 指标是否可用（handler 据此决定是否接收渲染层指标） */
export function isOtelMetricsEnabled(): boolean {
  return instruments !== null;
}

/** 记录一次 IPC 请求（成功/失败都记，错误率 SLO 的数据源） */
export function recordIpcRequest(
  channel: string,
  outcome: IpcOutcome,
  durationMs: number,
  failureClass: IpcFailureClass = outcome === 'success' ? 'none' : 'system',
): void {
  if (instruments === null) {
    return;
  }
  const attributes: Attributes = {
    channel,
    outcome,
    failureClass: outcome === 'success' ? 'none' : failureClass,
  };
  instruments.ipcRequests.add(1, attributes);
  instruments.ipcDuration.record(durationMs, attributes);
}

/** 区分隐藏启动，避免将未展示窗口的耗时混入前台启动分布。 */
export function recordStartupPhase(
  phase: 'services' | 'window' | 'ready-to-show' | 'renderer-ready',
  durationMs: number,
  mode: 'foreground' | 'hidden' = 'foreground',
): void {
  instruments?.startupDuration.record(durationMs, { phase, mode });
}

/** 记录更新漏斗事件（checking/available/not-available/downloaded/cancelled/error） */
export function recordUpdateEvent(phase: UpdateMetricPhase): void {
  instruments?.updateEvents.add(1, { phase });
}

/** 有效检查一对一样本，避免用漏斗事件数充当错误率分母。 */
export function recordUpdateCheck(
  trigger: UpdateCheckTrigger,
  outcome: 'success' | 'error',
  durationMs: number,
): void {
  const attributes: Attributes = { trigger, outcome };
  instruments?.updateChecks.add(1, attributes);
  instruments?.updateCheckDuration.record(durationMs, attributes);
}

/** 记录一次更新下载耗时（outcome：downloaded / cancelled / error） */
export function recordUpdateDownload(
  outcome: 'downloaded' | 'cancelled' | 'error',
  durationMs: number,
): void {
  instruments?.updateDownloadDuration.record(durationMs, { outcome });
}

/** 每个窗口的 p99 各记一次，形成窗口 p99 分布而非全部延迟的总体 p99。 */
export function recordEventLoopDelay(windowP99Ms: number): void {
  instruments?.eventLoopDelay.record(windowP99Ms);
}

/** 记录内存增长告警（连续递增窗口的涨幅与时长，归因用） */
export function recordMemoryGrowth(growthMb: number, durationSec: number): void {
  instruments?.memoryGrowth.record(growthMb, { window: String(Math.round(durationSec)) });
}

/** 记录一次数据库损坏自愈结局（每次启动都会记 healthy，作为恢复率分母） */
export function recordDbRecovery(outcome: DbRecoveryOutcome): void {
  instruments?.dbRecovery.add(1, { outcome });
}

/** 记录一次数据库备份结果与耗时（成功/失败都记） */
export function recordDbBackup(outcome: DbBackupOutcome, durationMs: number): void {
  if (instruments === null) {
    return;
  }
  const attributes: Attributes = { outcome };
  instruments.dbBackup.add(1, attributes);
  instruments.dbBackupDuration.record(durationMs, attributes);
}

/** 记录一次渲染进程崩溃（reason 白名单化，防属性高基数） */
export function recordRendererCrash(
  reason: string,
  recovery: 'reload' | 'stopped' = 'reload',
): void {
  instruments?.rendererCrashes.add(1, {
    reason: RENDERER_CRASH_REASONS.has(reason) ? reason : 'unknown',
    recovery,
  });
}

/**
 * 记录一条渲染层 Web Vital
 *
 * @returns true = 指标已接收；false = OTel metrics 未启用（遥测非 full 或未配置端点）
 */
export function recordWebVital(
  name: WebVitalName,
  value: number,
  attributes: { readonly rating?: string; readonly navigationType?: string } = {},
): boolean {
  if (instruments === null) {
    return false;
  }
  const labels: Attributes = {};
  if (attributes.rating !== undefined) {
    labels['rating'] = attributes.rating;
  }
  if (attributes.navigationType !== undefined) {
    labels['navigation.type'] = attributes.navigationType;
  }
  instruments.webVitals[name].record(value, labels);
  return true;
}
