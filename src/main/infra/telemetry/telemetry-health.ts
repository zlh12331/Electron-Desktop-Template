// telemetry-health.ts：遥测管道自监控——导出尝试/失败/最后成功时间 + 日志丢弃计数
// 边界：只在内存累计（单进程），不依赖 logger/OTel，避免诊断自身反向产生日志
import { redactText } from './redact';

/** 遥测信号 */
export type TelemetrySignal = 'traces' | 'metrics' | 'logs';

/** 单信号健康快照 */
interface SignalHealth {
  readonly attempts: number;
  readonly failures: number;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly lastError: string | null;
}

/** 汇总健康快照（诊断包/设置页展示） */
export interface TelemetryHealthSnapshot {
  readonly traces: SignalHealth;
  readonly metrics: SignalHealth;
  readonly logs: SignalHealth;
  /** 因采样被丢弃的 info/debug 日志条数 */
  readonly sampledLogs: number;
  /** 因每分钟上限被丢弃的非 error 日志条数 */
  readonly rateLimitedLogs: number;
  /** beforeSend 配额闸抑制的错误事件数（不含 native minidump）。 */
  readonly suppressedErrors: number;
  /** 最近一次日志丢弃时间 */
  readonly lastDropAt: number | null;
}

interface MutableSignalHealth {
  attempts: number;
  failures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

interface MutableHealth extends Record<TelemetrySignal, MutableSignalHealth> {
  sampledLogs: number;
  rateLimitedLogs: number;
  suppressedErrors: number;
  lastDropAt: number | null;
}

function createSignalHealth(): MutableSignalHealth {
  return {
    attempts: 0,
    failures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
  };
}

function createHealth(): MutableHealth {
  return {
    traces: createSignalHealth(),
    metrics: createSignalHealth(),
    logs: createSignalHealth(),
    sampledLogs: 0,
    rateLimitedLogs: 0,
    suppressedErrors: 0,
    lastDropAt: null,
  };
}

const state: MutableHealth = createHealth();

const MAX_ERROR_LENGTH = 500;

function safeErrorMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : error;
    return typeof message === 'string'
      ? redactText(message).slice(0, MAX_ERROR_LENGTH)
      : 'export failed';
  } catch {
    return 'export failed';
  }
}

/** 记录一次导出结果（成功/失败；失败保留脱敏后的短错误信息） */
export function recordExportResult(
  signal: TelemetrySignal,
  success: boolean,
  error?: unknown,
): void {
  const health = state[signal];
  health.attempts += 1;
  const now = Date.now();
  if (success) {
    health.lastSuccessAt = now;
    return;
  }
  health.failures += 1;
  health.lastFailureAt = now;
  health.lastError = safeErrorMessage(error);
}

/** 记录 beforeSend 限流；不使用 logger 以免递归制造遥测。 */
export function recordSuppressedError(): void {
  state.suppressedErrors += 1;
}

/** 记录一条日志被采样/限流丢弃 */
export function recordLogDrop(reason: 'sampled' | 'rate-limited'): void {
  if (reason === 'sampled') {
    state.sampledLogs += 1;
  } else {
    state.rateLimitedLogs += 1;
  }
  state.lastDropAt = Date.now();
}

function copySignal(health: MutableSignalHealth): SignalHealth {
  return { ...health };
}

/** 当前健康快照（返回副本，调用方不能改内部状态） */
export function getTelemetryHealth(): TelemetryHealthSnapshot {
  return {
    traces: copySignal(state.traces),
    metrics: copySignal(state.metrics),
    logs: copySignal(state.logs),
    sampledLogs: state.sampledLogs,
    rateLimitedLogs: state.rateLimitedLogs,
    suppressedErrors: state.suppressedErrors,
    lastDropAt: state.lastDropAt,
  };
}

/** 重新初始化管道时清空累计值（测试/重启初始化用） */
export function resetTelemetryHealth(): void {
  state.traces = createSignalHealth();
  state.metrics = createSignalHealth();
  state.logs = createSignalHealth();
  state.sampledLogs = 0;
  state.rateLimitedLogs = 0;
  state.suppressedErrors = 0;
  state.lastDropAt = null;
}
