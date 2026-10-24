// otel-log.ts：主进程结构化日志 → OTel Logs 的桥接状态（无 electron-log 依赖，避免循环）
// 边界：logger.ts 每次写日志后调用 emitOtelLog；OTel 未初始化时 sink 为 null，emit 立即返回
// 为什么不用 electron-log hook：主进程日志已统一经 logger.ts，直接在此收口可避免双 transport 重复导出

import type { OtelLogMinLevel } from '@code-agent/shared/observability';
import type { LogAttributes, Logger as OtelLogger } from '@opentelemetry/api-logs';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { FixedWindowRateLimiter } from './rate-limit';
import { redactSensitive, redactText } from './redact';
import { recordLogDrop } from './telemetry-health';

/** 可导出的日志级别（与 electron-log 的 error/warn/info/debug 对齐） */
type BridgeLogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Readonly<Record<OtelLogMinLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SEVERITY: Readonly<
  Record<BridgeLogLevel, { readonly number: SeverityNumber; readonly text: string }>
> = {
  debug: { number: SeverityNumber.DEBUG, text: 'DEBUG' },
  info: { number: SeverityNumber.INFO, text: 'INFO' },
  warn: { number: SeverityNumber.WARN, text: 'WARN' },
  error: { number: SeverityNumber.ERROR, text: 'ERROR' },
};

// 键名映射：主进程日志上下文是 camelCase，导出到 OTel 时补语义命名空间
const ATTRIBUTE_KEYS: Readonly<Record<string, string>> = {
  traceId: 'app.trace_id',
  channel: 'ipc.channel',
  scope: 'log.scope',
  errorCode: 'error.code',
  errorKind: 'error.kind',
  durationMs: 'ipc.duration_ms',
  processType: 'process.type',
  componentStack: 'error.component_stack',
};

const MAX_ATTRIBUTES = 24;

const MAX_ATTRIBUTE_LENGTH = 2_048;

const MAX_BODY_LENGTH = 8_192;

const MAX_STACK_LENGTH = 16_384;

/** 日志 sink 的导出策略 */
export interface OtelLogSinkOptions {
  /** 最低导出级别（error-only 固定 error） */
  readonly minLevel: OtelLogMinLevel;
  /** info/debug 随机采样率（warn/error 永不采样） */
  readonly sampleRatio: number;
  /** 非 error 日志每分钟上限（0 = 不限） */
  readonly maxPerMinute: number;
}

interface LogSink {
  readonly logger: OtelLogger;
  readonly options: OtelLogSinkOptions;
  readonly limiter: FixedWindowRateLimiter | null;
}

let sink: LogSink | null = null;

/**
 * 绑定 OTel Logger sink（otel.ts 初始化 LoggerProvider 后调用）
 *
 * @param logger 已绑定 resource 的 OTel Logger
 * @param options 级别/采样/限流策略
 */
export function setOtelLogSink(logger: OtelLogger, options: OtelLogSinkOptions): void {
  sink = {
    logger,
    options,
    limiter:
      options.maxPerMinute > 0 ? new FixedWindowRateLimiter(options.maxPerMinute, 60_000) : null,
  };
}

/** 解绑 sink（provider shutdown 前调用，避免 shutdown 过程中的迟到日志写入已关闭的 provider） */
export function clearOtelLogSink(): void {
  sink = null;
}

/** OTel Logs 是否可用（诊断与测试用） */
export function isOtelLogsEnabled(): boolean {
  return sink !== null;
}

function isBridgeLevel(level: string): level is BridgeLogLevel {
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function toAttributeValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text === undefined ? undefined : truncate(text, MAX_ATTRIBUTE_LENGTH);
}

/** 异常字段优先占用 24 属性预算，超额上下文允许丢弃。 */
function buildAttributes(
  context: Readonly<Record<string, unknown>>,
  exception: ExceptionParts | null,
): LogAttributes {
  const attributes: LogAttributes = {};
  if (exception !== null) {
    attributes['exception.type'] = exception.type;
    attributes['exception.message'] = exception.message;
    if (exception.stack !== undefined) {
      attributes['exception.stacktrace'] = exception.stack;
    }
  }
  let count = Object.keys(attributes).length;
  const safeContext = redactSensitive(context);
  if (safeContext === null || typeof safeContext !== 'object') {
    return attributes;
  }
  for (const [key, value] of Object.entries(safeContext)) {
    if (count >= MAX_ATTRIBUTES) {
      break;
    }
    if (key === 'error' || value === undefined || value === null) {
      continue;
    }
    const attribute = toAttributeValue(value);
    if (attribute !== undefined) {
      attributes[ATTRIBUTE_KEYS[key] ?? `log.${key}`] = attribute;
      count += 1;
    }
  }
  return attributes;
}

interface ExceptionParts {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
}

/** 从 logger.error 的 error 参数或上下文 error 字段提取异常信息（Error / 序列化对象均可） */
function extractException(
  context: Readonly<Record<string, unknown>>,
  error: unknown,
): ExceptionParts | null {
  const candidate = error ?? context['error'];
  if (candidate !== null && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>;
    const message = record['message'];
    const name = record['name'];
    const stack = record['stack'];
    return {
      type: truncate(redactText(typeof name === 'string' ? name : 'Error'), MAX_ATTRIBUTE_LENGTH),
      message: truncate(
        redactText(typeof message === 'string' ? message : ''),
        MAX_ATTRIBUTE_LENGTH,
      ),
      ...(typeof stack === 'string'
        ? { stack: truncate(redactText(stack), MAX_STACK_LENGTH) }
        : {}),
    };
  }
  return null;
}

/**
 * 把一条主进程日志转换为 OTel LogRecord 并交给 sink
 *
 * - 低于 minLevel 直接丢弃（error-only 只导出 error）
 * - 属性/正文/异常栈全部过脱敏；长度有界，防单条日志撑大导出批次
 * - sink 未绑定或导出器抛错均安静返回，遥测不能反噬日志路径
 *
 * @param level electron-log 级别
 * @param context 结构化上下文
 * @param message 日志正文
 * @param error 可选原始错误
 */
export function emitOtelLog(
  level: string,
  context: Readonly<Record<string, unknown>>,
  message: string,
  error?: unknown,
): void {
  if (sink === null || !isBridgeLevel(level)) {
    return;
  }
  if (LEVEL_RANK[level] < LEVEL_RANK[sink.options.minLevel]) {
    return;
  }
  // 只采样信息级：错误/告警必须保留；采样在限流前，避免采样掉的记录占用限流配额
  if (
    (level === 'info' || level === 'debug') &&
    sink.options.sampleRatio < 1 &&
    Math.random() >= sink.options.sampleRatio
  ) {
    recordLogDrop('sampled');
    return;
  }
  // 非 error 日志受每分钟上限约束；error 永远放行
  if (level !== 'error' && sink.limiter !== null && !sink.limiter.tryAcquire()) {
    recordLogDrop('rate-limited');
    return;
  }

  try {
    const severity = SEVERITY[level];
    const exception = extractException(context, error);
    const attributes = buildAttributes(context, exception);
    sink.logger.emit({
      severityNumber: severity.number,
      severityText: severity.text,
      body: truncate(redactText(message), MAX_BODY_LENGTH),
      attributes,
    });
  } catch {
    // 导出器异常不能影响本地日志
  }
}
