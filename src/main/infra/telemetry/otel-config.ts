// otel-config.ts：OpenTelemetry 环境配置解析（端点 / 采样 / 日志级别 / 指标导出间隔）
// 边界：纯函数，不读全局 process.env、不创建 provider——便于单测覆盖各分支
// 端点约定：OTEL_EXPORTER_OTLP_ENDPOINT 是 base URL（如 http://127.0.0.1:4318），
// 本文件补 /v1/traces|metrics|logs；也接受各信号专用变量（OTEL_EXPORTER_OTLP_TRACES_ENDPOINT 等）

import { EXECUTABLE_NAME, type TelemetryLevel } from '@code-agent/shared/main';

/** 日志桥接的最低导出级别（error-only 固定 error；full 默认 info） */
export type OtelLogMinLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: readonly OtelLogMinLevel[] = ['debug', 'info', 'warn', 'error'];

const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 60_000;

const MIN_METRIC_EXPORT_INTERVAL_MS = 1_000;

const MAX_METRIC_EXPORT_INTERVAL_MS = 600_000;

/** 解析后的 OTel 运行配置 */
export interface OtelResolvedConfig {
  /** 启动时遥测级别（error-only 仅错误日志，full 全量） */
  readonly level: TelemetryLevel;
  /** 是否有任何信号需要初始化（false = 完全 no-op） */
  readonly enabled: boolean;
  /** dev 且无端点时用 ConsoleSpanExporter（仅本地观察） */
  readonly consoleTracing: boolean;
  /** trace 导出端点（null = 不启用 trace） */
  readonly traceEndpoint: string | null;
  /** metrics 导出端点（null = 不启用 metrics） */
  readonly metricEndpoint: string | null;
  /** logs 导出端点（null = 不启用 logs） */
  readonly logEndpoint: string | null;
  /** 根 span 采样比例（0..1） */
  readonly traceSampleRatio: number;
  /** 日志桥接最低级别 */
  readonly logMinLevel: OtelLogMinLevel;
  /** 指标导出间隔（毫秒） */
  readonly metricExportIntervalMs: number;
  /** OTLP 请求头（OTEL_EXPORTER_OTLP_HEADERS，SigNoz Cloud ingestion key 等） */
  readonly headers: Readonly<Record<string, string>>;
  /** 服务名（OTEL_SERVICE_NAME 覆盖，默认 {可执行名}-prod/dev） */
  readonly serviceName: string;
}

/** 解析选项（打包态决定「无端点是否退回 console」与默认采样率） */
export interface OtelConfigOptions {
  readonly isPackaged: boolean;
  readonly level: TelemetryLevel;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? '';
}

/** 把 base URL 落到某个信号的 /v1/{signal} 路径；用户误填完整信号路径时替换最后一段 */
export function deriveSignalEndpoint(base: string, signal: 'traces' | 'metrics' | 'logs'): string {
  const trimmed = base.replace(/\/+$/, '');
  if (/\/v1\/(?:traces|metrics|logs)$/i.test(trimmed)) {
    return trimmed.replace(/\/v1\/(?:traces|metrics|logs)$/i, `/v1/${signal}`);
  }
  return `${trimmed}/v1/${signal}`;
}

function resolveSignalEndpoint(
  env: NodeJS.ProcessEnv,
  signal: 'traces' | 'metrics' | 'logs',
): string | null {
  const specificKey = {
    traces: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    metrics: 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    logs: 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  }[signal];
  const specific = readEnv(env, specificKey);
  if (specific !== '') {
    return specific;
  }
  const base = readEnv(env, 'OTEL_EXPORTER_OTLP_ENDPOINT');
  return base === '' ? null : deriveSignalEndpoint(base, signal);
}

function parseRatio(raw: string, fallback: number): number {
  if (raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return fallback;
  }
  return value;
}

function resolveSampleRatio(env: NodeJS.ProcessEnv, isPackaged: boolean): number {
  const sampler = readEnv(env, 'OTEL_TRACES_SAMPLER').toLowerCase();
  if (sampler === 'always_off') {
    return 0;
  }
  if (sampler === 'always_on') {
    return 1;
  }
  return parseRatio(readEnv(env, 'OTEL_TRACES_SAMPLER_ARG'), isPackaged ? 0.2 : 1);
}

function resolveLogLevel(env: NodeJS.ProcessEnv, level: TelemetryLevel): OtelLogMinLevel {
  if (level === 'error-only') {
    return 'error';
  }
  const raw = readEnv(env, 'OTEL_LOG_LEVEL').toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw) ? (raw as OtelLogMinLevel) : 'info';
}

/** 解析 OTEL_EXPORTER_OTLP_HEADERS（key=value,key2=value2；非法片段跳过） */
export function resolveOtlpHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const index = pair.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key !== '' && value !== '') {
      headers[key] = value;
    }
  }
  return headers;
}

function resolveServiceName(env: NodeJS.ProcessEnv, isPackaged: boolean): string {
  const configured = readEnv(env, 'OTEL_SERVICE_NAME');
  if (configured !== '') {
    return configured;
  }
  return `${EXECUTABLE_NAME}-${isPackaged ? 'prod' : 'dev'}`;
}

function resolveMetricInterval(env: NodeJS.ProcessEnv): number {
  const raw = readEnv(env, 'OTEL_METRIC_EXPORT_INTERVAL');
  if (raw === '') {
    return DEFAULT_METRIC_EXPORT_INTERVAL_MS;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return DEFAULT_METRIC_EXPORT_INTERVAL_MS;
  }
  return Math.min(
    MAX_METRIC_EXPORT_INTERVAL_MS,
    Math.max(MIN_METRIC_EXPORT_INTERVAL_MS, Math.round(value)),
  );
}

/**
 * 解析 OTel 配置
 *
 * - 遥测 off → 完全禁用
 * - 有任意 OTLP 端点 → 按级别启用的信号都走 OTLP
 * - dev 无端点 → 只启用 Console trace（本地观察，不外发）
 * - 打包版无端点 → 完全禁用
 *
 * @param env 环境变量（测试注入）
 * @param options 打包态与遥测级别
 * @returns 解析后的配置
 */
export function resolveOtelConfig(
  env: NodeJS.ProcessEnv,
  options: OtelConfigOptions,
): OtelResolvedConfig {
  const { isPackaged, level } = options;
  const traces = resolveSignalEndpoint(env, 'traces');
  const metrics = resolveSignalEndpoint(env, 'metrics');
  const logs = resolveSignalEndpoint(env, 'logs');
  const hasEndpoint = traces !== null || metrics !== null || logs !== null;
  // error-only 只导出错误日志（trace/metrics 关闭，错误聚合走 Sentry）；
  // full 才启用 trace/metrics，dev 无端点时用 Console trace 本地观察
  const enabled =
    level === 'off' ? false : level === 'full' ? hasEndpoint || !isPackaged : logs !== null;
  const fullSignals = enabled && level === 'full';

  return {
    level,
    enabled,
    consoleTracing: fullSignals && !hasEndpoint,
    traceEndpoint: fullSignals ? traces : null,
    metricEndpoint: fullSignals ? metrics : null,
    logEndpoint: enabled ? logs : null,
    traceSampleRatio: resolveSampleRatio(env, isPackaged),
    logMinLevel: resolveLogLevel(env, level),
    metricExportIntervalMs: resolveMetricInterval(env),
    headers: resolveOtlpHeaders(readEnv(env, 'OTEL_EXPORTER_OTLP_HEADERS')),
    serviceName: resolveServiceName(env, isPackaged),
  };
}
