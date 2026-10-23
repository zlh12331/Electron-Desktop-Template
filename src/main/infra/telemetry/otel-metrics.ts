// otel-metrics.ts：业务指标注册表——IPC / 启动 / 更新 / 事件循环 / 内存 / Web Vitals
// 边界：只持有 instrument 句柄并在 init 时注册 observable 回调；OTel 未初始化时所有 record* 为 no-op
// 命名遵循 OTel 语义约定（点分小写）：服务端指标用 ipc.* / process.* / nodejs.*，产品指标用 app.* / web_vitals.*

import type { WebVitalName } from '@code-agent/shared/main';
import { OBSERVABILITY_METRICS, WEB_VITAL_METRICS } from '@code-agent/shared/observability';
import type { Attributes, Counter, Histogram, Meter, ObservableGauge } from '@opentelemetry/api';
import { app } from 'electron';

/** 单次 IPC 请求结果（指标标签，基数有界） */
export type IpcOutcome = 'success' | 'error';

/** 更新漏斗阶段（与 UpdateStatusPayload.phase 对齐，额外含 manual-check） */
export type UpdateMetricPhase =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloaded'
  | 'cancelled'
  | 'error';

interface MetricInstruments {
  readonly ipcRequests: Counter<Attributes>;
  readonly ipcDuration: Histogram<Attributes>;
  readonly startupDuration: Histogram<Attributes>;
  readonly updateEvents: Counter<Attributes>;
  readonly updateCheckDuration: Histogram<Attributes>;
  readonly updateDownloadDuration: Histogram<Attributes>;
  readonly eventLoopDelay: Histogram<Attributes>;
  readonly memoryGrowth: Histogram<Attributes>;
  readonly webVitals: Record<WebVitalName, Histogram<Attributes>>;
}

let instruments: MetricInstruments | null = null;

/** 把 Web Vitals 名字映射到独立 histogram（CLS 无量纲，其余毫秒） */
function createWebVitalInstruments(meter: Meter): Record<WebVitalName, Histogram<Attributes>> {
  const create = (name: string, unit: string): Histogram<Attributes> =>
    meter.createHistogram(name, {
      description: `Renderer Web Vital ${name.split('.').pop() ?? name}`,
      unit,
    });
  return {
    ['CLS']: create(WEB_VITAL_METRICS.CLS, '1'),
    ['FCP']: create(WEB_VITAL_METRICS.FCP, 'ms'),
    ['INP']: create(WEB_VITAL_METRICS.INP, 'ms'),
    ['LCP']: create(WEB_VITAL_METRICS.LCP, 'ms'),
    ['TTFB']: create(WEB_VITAL_METRICS.TTFB, 'ms'),
  };
}

/** 注册进程级 observable gauge（内存 / 各 Electron 进程 CPU 与工作集） */
function registerProcessGauges(meter: Meter): void {
  const memoryGauge: ObservableGauge<Attributes> = meter.createObservableGauge(
    OBSERVABILITY_METRICS.processMemoryUsage,
    {
      description: 'Node.js process memory usage',
      unit: 'By',
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
      unit: 'By',
    },
  );
  const processCpuGauge = meter.createObservableGauge(OBSERVABILITY_METRICS.electronProcessCpu, {
    description: 'Electron process CPU usage (0-100)',
    unit: 'percent',
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
      description: 'IPC request count by channel and outcome',
    }),
    ipcDuration: meter.createHistogram(OBSERVABILITY_METRICS.ipcRequestDuration, {
      description: 'IPC request duration by channel and outcome',
      unit: 'ms',
    }),
    startupDuration: meter.createHistogram(OBSERVABILITY_METRICS.startupDuration, {
      description: 'Application startup duration by phase',
      unit: 'ms',
    }),
    updateEvents: meter.createCounter(OBSERVABILITY_METRICS.updateEvents, {
      description: 'Auto-update funnel events',
    }),
    updateCheckDuration: meter.createHistogram(OBSERVABILITY_METRICS.updateCheckDuration, {
      description: 'Update check duration by trigger and outcome',
      unit: 'ms',
    }),
    updateDownloadDuration: meter.createHistogram(OBSERVABILITY_METRICS.updateDownloadDuration, {
      description: 'Update download duration by outcome',
      unit: 'ms',
    }),
    eventLoopDelay: meter.createHistogram(OBSERVABILITY_METRICS.eventLoopDelay, {
      description: 'Main process event loop delay p99 per sampling window',
      unit: 'ms',
    }),
    memoryGrowth: meter.createHistogram(OBSERVABILITY_METRICS.memoryGrowth, {
      description: 'Detected RSS growth over a monotonic sampling window',
      unit: 'MB',
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
export function recordIpcRequest(channel: string, outcome: IpcOutcome, durationMs: number): void {
  if (instruments === null) {
    return;
  }
  const attributes: Attributes = { channel, outcome };
  instruments.ipcRequests.add(1, attributes);
  instruments.ipcDuration.record(durationMs, attributes);
}

/** 记录启动阶段耗时（phase：services / window 等） */
export function recordStartupPhase(phase: string, durationMs: number): void {
  instruments?.startupDuration.record(durationMs, { phase });
}

/** 记录更新漏斗事件（checking/available/not-available/downloaded/cancelled/error） */
export function recordUpdateEvent(phase: UpdateMetricPhase): void {
  instruments?.updateEvents.add(1, { phase });
}

/** 记录一次更新检查耗时（trigger：launch / manual / retry / long-session） */
export function recordUpdateCheck(trigger: string, outcome: string, durationMs: number): void {
  instruments?.updateCheckDuration.record(durationMs, { trigger, outcome });
}

/** 记录一次更新下载耗时（outcome：downloaded / cancelled / error） */
export function recordUpdateDownload(outcome: string, durationMs: number): void {
  instruments?.updateDownloadDuration.record(durationMs, { outcome });
}

/** 记录事件循环 p99 延迟（每 5s 采样一次，SLO/告警数据源） */
export function recordEventLoopDelay(lagMs: number): void {
  instruments?.eventLoopDelay.record(lagMs);
}

/** 记录内存增长告警（连续递增窗口的涨幅与时长，归因用） */
export function recordMemoryGrowth(growthMb: number, durationSec: number): void {
  instruments?.memoryGrowth.record(growthMb, { window: String(Math.round(durationSec)) });
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
