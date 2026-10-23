// resolve.ts：可观测性配置纯解析——远端不读、不创建 provider，运行时/脚本/doctor 共用
// 优先级：运行时 env > 构建期 DSN > 代码默认值；遥测级别来自 telemetry-pref（由调用方传入）

import { EXECUTABLE_NAME } from '../constants/brand';
import { OBSERVABILITY_ENV as ENV } from './env';
import type { TelemetryLevel } from './telemetry-level';

/** 环境变量视图（NodeJS.ProcessEnv 与测试对象均可赋值） */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** OTel 日志导出最低级别 */
export type OtelLogMinLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: readonly OtelLogMinLevel[] = ['debug', 'info', 'warn', 'error'];

/** 指标导出间隔默认/上下限（毫秒） */
export const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 60_000;
export const MIN_METRIC_EXPORT_INTERVAL_MS = 1_000;
export const MAX_METRIC_EXPORT_INTERVAL_MS = 600_000;

/** 日志导出上限（每分钟）；0 = 不限制 */
export const DEFAULT_OTEL_LOG_MAX_PER_MINUTE = 0;

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
  /** info/debug 日志采样比例（warn/error 永不采样） */
  readonly logSampleRatio: number;
  /** 非 error 日志每分钟导出上限（0 = 不限） */
  readonly logMaxPerMinute: number;
  /** 指标导出间隔（毫秒） */
  readonly metricExportIntervalMs: number;
  /** OTLP 请求头 */
  readonly headers: Readonly<Record<string, string>>;
  /** 服务名（OTEL_SERVICE_NAME 覆盖，默认 {可执行名}-prod/dev） */
  readonly serviceName: string;
}

/** 解析后的 Sentry 运行配置 */
export interface SentryResolvedConfig {
  /** 是否满足初始化条件（级别非 off 且 DSN 非空） */
  readonly enabled: boolean;
  /** 未启用原因（enabled=true 时为 null） */
  readonly reason: 'telemetry-off' | 'no-dsn' | null;
  /** 生效 DSN（未配置为空串；doctor 展示前必须脱敏） */
  readonly dsn: string;
  /** 生效 release */
  readonly release: string;
  /** 生效 environment */
  readonly environment: string;
}

/** source map / debug files 上传配置 */
export interface SentryUploadConfig {
  readonly authToken: string;
  readonly org: string;
  readonly project: string;
  readonly release: string;
  readonly outDir: string;
  /** 非空 = 本次跳过上传（缺少凭据或显式禁用） */
  readonly skipReason: string | null;
  /** 缺失的凭据（doctor 据此区分“全未配置”和“半配置”） */
  readonly missingCredentials: readonly string[];
}

/** 组合后的可观测性配置（doctor/状态展示） */
export interface ObservabilityResolvedConfig {
  readonly level: TelemetryLevel;
  readonly sentry: SentryResolvedConfig;
  readonly otel: OtelResolvedConfig;
}

/** 解析选项 */
export interface ObservabilityResolveOptions {
  readonly isPackaged: boolean;
  readonly level: TelemetryLevel;
  readonly version: string;
  /** 可执行名（默认取品牌常量；脚本传 app.config.json） */
  readonly executableName?: string;
  /** 构建期注入的 DSN（electron-vite define；脚本/测试传空串） */
  readonly buildDsn?: string;
}

function readEnv(env: EnvLike, key: string): string {
  return env[key]?.trim() ?? '';
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

function resolveSampleRatio(env: EnvLike, isPackaged: boolean): number {
  const sampler = readEnv(env, ENV.OTEL_TRACES_SAMPLER).toLowerCase();
  if (sampler === 'always_off') {
    return 0;
  }
  if (sampler === 'always_on') {
    return 1;
  }
  return parseRatio(readEnv(env, ENV.OTEL_TRACES_SAMPLER_ARG), isPackaged ? 0.2 : 1);
}

/** 日志最低级别：error-only 固定 error；full 默认 info */
export function resolveOtelLogLevel(env: EnvLike, level: TelemetryLevel): OtelLogMinLevel {
  if (level === 'error-only') {
    return 'error';
  }
  const raw = readEnv(env, ENV.OTEL_LOG_LEVEL).toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw) ? (raw as OtelLogMinLevel) : 'info';
}

/** 日志采样比例：非法值回落 1（不采样） */
export function resolveOtelLogSampleRatio(env: EnvLike): number {
  const raw = readEnv(env, ENV.OTEL_LOG_SAMPLE_RATIO);
  if (raw === '') {
    return 1;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return 1;
  }
  return value;
}

/** 日志每分钟上限：非法/负数回落 0（不限），上限 1,000,000 防误填 */
export function resolveOtelLogMaxPerMinute(env: EnvLike): number {
  const raw = readEnv(env, ENV.OTEL_LOG_MAX_PER_MINUTE);
  if (raw === '') {
    return DEFAULT_OTEL_LOG_MAX_PER_MINUTE;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_OTEL_LOG_MAX_PER_MINUTE;
  }
  return Math.min(1_000_000, Math.round(value));
}

/** 指标导出间隔：非法回落默认，越界收敛到 1s..600s */
export function resolveMetricExportInterval(env: EnvLike): number {
  const raw = readEnv(env, ENV.OTEL_METRIC_EXPORT_INTERVAL);
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

/** 把 base URL 落到某个信号的 /v1/{signal} 路径；误填完整信号路径时替换最后一段 */
export function deriveSignalEndpoint(base: string, signal: 'traces' | 'metrics' | 'logs'): string {
  const trimmed = base.replace(/\/+$/, '');
  if (/\/v1\/(?:traces|metrics|logs)$/i.test(trimmed)) {
    return trimmed.replace(/\/v1\/(?:traces|metrics|logs)$/i, `/v1/${signal}`);
  }
  return `${trimmed}/v1/${signal}`;
}

function resolveSignalEndpoint(env: EnvLike, signal: 'traces' | 'metrics' | 'logs'): string | null {
  const specificKey = {
    traces: ENV.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    metrics: ENV.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    logs: ENV.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
  }[signal];
  const specific = readEnv(env, specificKey);
  if (specific !== '') {
    return specific;
  }
  const base = readEnv(env, ENV.OTEL_EXPORTER_OTLP_ENDPOINT);
  return base === '' ? null : deriveSignalEndpoint(base, signal);
}

function resolveServiceName(env: EnvLike, isPackaged: boolean, executableName: string): string {
  const configured = readEnv(env, ENV.OTEL_SERVICE_NAME);
  if (configured !== '') {
    return configured;
  }
  return `${executableName}-${isPackaged ? 'prod' : 'dev'}`;
}

/**
 * 解析 OTel 配置
 *
 * - off → 完全禁用
 * - full：有端点走 OTLP；dev 无端点走 Console trace
 * - error-only：只有日志端点时启用，仅导出 error
 */
export function resolveOtelConfig(
  env: EnvLike,
  options: Omit<ObservabilityResolveOptions, 'version' | 'buildDsn'>,
): OtelResolvedConfig {
  const { isPackaged, level } = options;
  const executableName = options.executableName ?? EXECUTABLE_NAME;
  const traces = resolveSignalEndpoint(env, 'traces');
  const metrics = resolveSignalEndpoint(env, 'metrics');
  const logs = resolveSignalEndpoint(env, 'logs');
  const hasEndpoint = traces !== null || metrics !== null || logs !== null;
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
    logMinLevel: resolveOtelLogLevel(env, level),
    logSampleRatio: resolveOtelLogSampleRatio(env),
    logMaxPerMinute: resolveOtelLogMaxPerMinute(env),
    metricExportIntervalMs: resolveMetricExportInterval(env),
    headers: resolveOtlpHeaders(readEnv(env, ENV.OTEL_EXPORTER_OTLP_HEADERS)),
    serviceName: resolveServiceName(env, isPackaged, executableName),
  };
}

/** 解析 Sentry release：运行时与上传脚本必须同源 */
export function resolveSentryRelease(
  env: EnvLike,
  executableName: string,
  version: string,
): string {
  const override = readEnv(env, ENV.SENTRY_RELEASE);
  return override !== '' ? override : `${executableName}@${version}`;
}

/** 解析 Sentry environment：打包默认 production，dev 默认 development */
export function resolveSentryEnvironment(env: EnvLike, isPackaged: boolean): string {
  const override = readEnv(env, ENV.SENTRY_ENVIRONMENT);
  return override !== '' ? override : isPackaged ? 'production' : 'development';
}

/** 解析生效 DSN：运行时优先于构建期注入 */
export function resolveSentryDsn(env: EnvLike, buildDsn = ''): string {
  const runtime = readEnv(env, ENV.SENTRY_DSN);
  return runtime !== '' ? runtime : buildDsn.trim();
}

/** 解析 Sentry 运行配置（不初始化 SDK） */
export function resolveSentryConfig(
  env: EnvLike,
  options: ObservabilityResolveOptions,
): SentryResolvedConfig {
  const executableName = options.executableName ?? EXECUTABLE_NAME;
  const dsn = resolveSentryDsn(env, options.buildDsn ?? '');
  const release = resolveSentryRelease(env, executableName, options.version);
  const environment = resolveSentryEnvironment(env, options.isPackaged);
  if (options.level === 'off') {
    return { enabled: false, reason: 'telemetry-off', dsn, release, environment };
  }
  if (dsn === '') {
    return { enabled: false, reason: 'no-dsn', dsn, release, environment };
  }
  return { enabled: true, reason: null, dsn, release, environment };
}

/** 解析 source map / debug files 上传配置；三项凭据任一缺失即跳过 */
export function resolveSentryUploadConfig(
  env: EnvLike,
  executableName: string,
  version: string,
  outDir: string,
): SentryUploadConfig {
  const authToken = readEnv(env, ENV.SENTRY_AUTH_TOKEN);
  const org = readEnv(env, ENV.SENTRY_ORG);
  const project = readEnv(env, ENV.SENTRY_PROJECT);
  const release = resolveSentryRelease(env, executableName, version);
  const missingCredentials = [
    ...(authToken === '' ? [ENV.SENTRY_AUTH_TOKEN] : []),
    ...(org === '' ? [ENV.SENTRY_ORG] : []),
    ...(project === '' ? [ENV.SENTRY_PROJECT] : []),
  ];

  let skipReason: string | null = null;
  if (readEnv(env, ENV.SENTRY_UPLOAD_DISABLED) === '1') {
    skipReason = `${ENV.SENTRY_UPLOAD_DISABLED}=1`;
  } else if (missingCredentials.length > 0) {
    skipReason = `缺少 ${missingCredentials.join(' / ')}`;
  }

  return { authToken, org, project, release, outDir, skipReason, missingCredentials };
}

/** 组合解析（doctor/状态展示；上传配置因需要 outDir 单独解析） */
export function resolveObservabilityConfig(
  env: EnvLike,
  options: ObservabilityResolveOptions,
): ObservabilityResolvedConfig {
  return {
    level: options.level,
    sentry: resolveSentryConfig(env, options),
    otel: resolveOtelConfig(env, options),
  };
}

/** 校验 HTTP(S) URL；返回 null 表示合法，否则返回原因 */
export function validateHttpEndpoint(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '仅支持 http/https';
    }
    return null;
  } catch {
    return 'URL 格式无效';
  }
}

/** Sentry DSN 解析结果（不包含 public key） */
export interface SentryDsnInfo {
  readonly valid: boolean;
  readonly message: string;
  readonly host: string | null;
  readonly projectId: string | null;
}

/** 校验 DSN 结构（不发起网络请求） */
export function parseSentryDsn(dsn: string): SentryDsnInfo {
  if (dsn.trim() === '') {
    return { valid: false, message: '未配置 DSN', host: null, projectId: null };
  }
  try {
    const url = new URL(dsn);
    const protocolOk = url.protocol === 'http:' || url.protocol === 'https:';
    const projectId = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
    if (!protocolOk || url.username === '' || projectId === '') {
      return { valid: false, message: 'DSN 结构无效', host: null, projectId: null };
    }
    return { valid: true, message: 'DSN 结构有效', host: url.host, projectId };
  } catch {
    return { valid: false, message: 'DSN 不是合法 URL', host: null, projectId: null };
  }
}

/** 脱敏展示 DSN（保留 host/project，隐藏 public key） */
export function maskSentryDsn(dsn: string): string {
  const info = parseSentryDsn(dsn);
  if (!info.valid || info.host === null || info.projectId === null) {
    return '<invalid>';
  }
  try {
    const protocol = new URL(dsn).protocol;
    return `${protocol}//***@${info.host}/${info.projectId}`;
  } catch {
    return '<invalid>';
  }
}
