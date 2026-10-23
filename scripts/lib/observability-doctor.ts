// observability-doctor.ts：doctor 的纯检查逻辑（格式化/CLI 在 scripts/observability-doctor.ts）
import type {
  ObservabilityResolvedConfig,
  OtelResolvedConfig,
  SentryUploadConfig,
} from '@code-agent/shared/observability';
import {
  type EnvLike,
  maskSentryDsn,
  OBSERVABILITY_ENV,
  type OtlpProbeTarget,
  parseSentryDsn,
  resolveOtlpHeaders,
  validateHttpEndpoint,
} from '@code-agent/shared/observability';

/** 检查状态 */
export type DoctorCheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

/** 单条检查结果 */
export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorCheckStatus;
  readonly message: string;
}

/** 探测目标（doctor 输出/测试用） */
export function buildProbeTargets(config: OtelResolvedConfig): readonly OtlpProbeTarget[] {
  const targets: OtlpProbeTarget[] = [];
  if (config.traceEndpoint !== null) {
    targets.push({ signal: 'traces', url: config.traceEndpoint });
  }
  if (config.metricEndpoint !== null) {
    targets.push({ signal: 'metrics', url: config.metricEndpoint });
  }
  if (config.logEndpoint !== null) {
    targets.push({ signal: 'logs', url: config.logEndpoint });
  }
  return targets;
}

function checkRatioOverride(env: EnvLike, key: string, checks: DoctorCheck[]): void {
  const raw = env[key]?.trim() ?? '';
  if (raw === '') {
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    checks.push({
      id: `env.${key}`,
      status: 'warn',
      message: `${key}=${raw} 非 0..1，运行时将回落默认值`,
    });
  }
}

function checkPositiveIntOverride(env: EnvLike, key: string, checks: DoctorCheck[]): void {
  const raw = env[key]?.trim() ?? '';
  if (raw === '') {
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    checks.push({
      id: `env.${key}`,
      status: 'warn',
      message: `${key}=${raw} 不是非负数，运行时将回落默认值`,
    });
  }
}

function checkOtelEndpoints(config: OtelResolvedConfig, checks: DoctorCheck[]): void {
  const endpoints: Array<{ signal: string; url: string | null }> = [
    { signal: 'traces', url: config.traceEndpoint },
    { signal: 'metrics', url: config.metricEndpoint },
    { signal: 'logs', url: config.logEndpoint },
  ];
  for (const endpoint of endpoints) {
    if (endpoint.url === null) {
      continue;
    }
    const error = validateHttpEndpoint(endpoint.url);
    checks.push({
      id: `otel.${endpoint.signal}.endpoint`,
      status: error === null ? 'ok' : 'fail',
      message:
        error === null ? `${endpoint.signal} 端点格式合法` : `${endpoint.signal} 端点：${error}`,
    });
  }
}

function checkOtelOverrides(env: EnvLike, checks: DoctorCheck[]): void {
  checkRatioOverride(env, OBSERVABILITY_ENV.OTEL_TRACES_SAMPLER_ARG, checks);
  checkRatioOverride(env, OBSERVABILITY_ENV.OTEL_LOG_SAMPLE_RATIO, checks);
  checkPositiveIntOverride(env, OBSERVABILITY_ENV.OTEL_LOG_MAX_PER_MINUTE, checks);
  checkPositiveIntOverride(env, OBSERVABILITY_ENV.OTEL_METRIC_EXPORT_INTERVAL, checks);

  const sampler = env[OBSERVABILITY_ENV.OTEL_TRACES_SAMPLER]?.trim().toLowerCase() ?? '';
  if (
    sampler !== '' &&
    sampler !== 'always_on' &&
    sampler !== 'always_off' &&
    sampler !== 'parentbased_traceidratio' &&
    sampler !== 'traceidratio'
  ) {
    checks.push({
      id: 'env.OTEL_TRACES_SAMPLER',
      status: 'warn',
      message: `未知采样器 ${sampler}，运行时按 parentbased_traceidratio 处理`,
    });
  }

  const logLevel = env[OBSERVABILITY_ENV.OTEL_LOG_LEVEL]?.trim().toLowerCase() ?? '';
  if (logLevel !== '' && !['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    checks.push({
      id: 'env.OTEL_LOG_LEVEL',
      status: 'warn',
      message: `OTEL_LOG_LEVEL=${logLevel} 非法，运行时回落 info`,
    });
  }

  const headersRaw = env[OBSERVABILITY_ENV.OTEL_EXPORTER_OTLP_HEADERS]?.trim() ?? '';
  if (headersRaw !== '' && Object.keys(resolveOtlpHeaders(headersRaw)).length === 0) {
    checks.push({
      id: 'env.OTEL_EXPORTER_OTLP_HEADERS',
      status: 'warn',
      message: 'OTEL_EXPORTER_OTLP_HEADERS 没有解析出任何 key=value',
    });
  }
}

function checkUpload(
  env: EnvLike,
  upload: SentryUploadConfig,
  strict: boolean,
  checks: DoctorCheck[],
): void {
  if (upload.missingCredentials.length === 0) {
    checks.push({ id: 'upload.credentials', status: 'ok', message: '上传凭据齐全' });
  } else if (upload.missingCredentials.length === 3) {
    checks.push({
      id: 'upload.credentials',
      status: 'skip',
      message: '未配置 Sentry 上传凭据，跳过 source map 上传',
    });
  } else {
    checks.push({
      id: 'upload.credentials',
      status: strict ? 'fail' : 'warn',
      message: `上传凭据半配置：缺少 ${upload.missingCredentials.join(' / ')}`,
    });
  }

  if (upload.skipReason === `${OBSERVABILITY_ENV.SENTRY_UPLOAD_DISABLED}=1`) {
    checks.push({
      id: 'upload.disabled',
      status: 'warn',
      message: 'SENTRY_UPLOAD_DISABLED=1，已显式跳上传',
    });
  }
  if (
    (env[OBSERVABILITY_ENV.SENTRY_AUTH_TOKEN]?.trim() ?? '') !== '' &&
    (env[OBSERVABILITY_ENV.SENTRY_DSN]?.trim() ?? '') === ''
  ) {
    checks.push({
      id: 'sentry.token-without-dsn',
      status: 'warn',
      message: '配置了上传 token 但运行时 DSN 为空；source map 会上传，但应用不会上报错误',
    });
  }
  if ((env[OBSERVABILITY_ENV.SENTRY_RELEASE]?.trim() ?? '') !== '') {
    checks.push({
      id: 'sentry.release-override',
      status: 'warn',
      message:
        'SENTRY_RELEASE 只影响构建/上传环境；安装包运行时仍按默认 release，除非同时设置运行时变量',
    });
  }
}

/** 根据生效配置与环境变量产出静态检查（不含网络探测） */
export function buildDoctorChecks(
  env: EnvLike,
  resolved: ObservabilityResolvedConfig,
  upload: SentryUploadConfig,
  options: { readonly strictUpload: boolean },
): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  if (resolved.level === 'off') {
    checks.push({
      id: 'level',
      status: 'warn',
      message: '遥测级别 off：Sentry/OTel 都不会初始化（本地日志仍写）',
    });
  } else {
    checks.push({ id: 'level', status: 'ok', message: `遥测级别 ${resolved.level}` });
  }

  if (resolved.sentry.enabled) {
    const dsn = parseSentryDsn(resolved.sentry.dsn);
    checks.push({
      id: 'sentry.dsn',
      status: dsn.valid ? 'ok' : 'fail',
      message: dsn.valid ? `DSN 结构有效（${maskSentryDsn(resolved.sentry.dsn)}）` : dsn.message,
    });
  } else {
    checks.push({
      id: 'sentry.dsn',
      status: 'skip',
      message:
        resolved.sentry.reason === 'telemetry-off'
          ? '遥测 off，跳过 Sentry'
          : '未配置 DSN（Sentry no-op）',
    });
  }

  if (resolved.otel.enabled) {
    checks.push({ id: 'otel.enabled', status: 'ok', message: '至少一个 OTel 信号启用' });
    checkOtelEndpoints(resolved.otel, checks);
  } else {
    checks.push({
      id: 'otel.enabled',
      status: 'warn',
      message: 'OTel 未启用（级别 off / 打包版无端点 / error-only 无日志端点）',
    });
  }
  checkOtelOverrides(env, checks);

  checkUpload(env, upload, options.strictUpload, checks);
  return checks;
}

/** 是否存在 fail */
export function hasFailures(checks: readonly DoctorCheck[]): boolean {
  return checks.some((check) => check.status === 'fail');
}

/** 输出用的脱敏配置摘要（不含 DSN key、token、header 值） */
export function summarizeConfig(
  resolved: ObservabilityResolvedConfig,
  upload: SentryUploadConfig,
): Record<string, unknown> {
  return {
    level: resolved.level,
    sentry: {
      enabled: resolved.sentry.enabled,
      reason: resolved.sentry.reason,
      release: resolved.sentry.release,
      environment: resolved.sentry.environment,
      dsn: resolved.sentry.dsn === '' ? '' : maskSentryDsn(resolved.sentry.dsn),
    },
    otel: {
      enabled: resolved.otel.enabled,
      serviceName: resolved.otel.serviceName,
      traceEndpoint: resolved.otel.traceEndpoint,
      metricEndpoint: resolved.otel.metricEndpoint,
      logEndpoint: resolved.otel.logEndpoint,
      traceSampleRatio: resolved.otel.traceSampleRatio,
      logMinLevel: resolved.otel.logMinLevel,
      logSampleRatio: resolved.otel.logSampleRatio,
      logMaxPerMinute: resolved.otel.logMaxPerMinute,
      metricExportIntervalMs: resolved.otel.metricExportIntervalMs,
      headerKeys: Object.keys(resolved.otel.headers),
    },
    upload: {
      ready: upload.skipReason === null,
      skipReason: upload.skipReason,
      missingCredentials: upload.missingCredentials,
      release: upload.release,
    },
  };
}
