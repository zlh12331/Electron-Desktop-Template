/**
 * 可观测性环境变量注册表（配置单一真源）
 *
 * 所有 SENTRY_* / OTEL_* 变量名、作用域、默认值、敏感性都从这里派生：
 * 运行时解析、构建脚本、doctor、文档/CI 校验共用，禁止在业务代码里散写字面量。
 */
export type ObservabilityEnvScope = 'runtime' | 'build' | 'ci';

/** 单个环境变量的元数据 */
export interface ObservabilityEnvEntry {
  /** 变量名（同时作为 .env.example 的键） */
  readonly key: string;
  /** 生效阶段（同一键可跨多个阶段） */
  readonly scopes: readonly ObservabilityEnvScope[];
  /** 默认值（派生值用空串表示） */
  readonly defaultValue: string;
  /** 一句话说明（用于配置参考表） */
  readonly description: string;
  /** 是否含凭据/令牌（doctor 输出必须脱敏） */
  readonly sensitive: boolean;
  /** 修改后是否必须重启应用 */
  readonly restartRequired: boolean;
  /** 消费方（便于排查“谁在读它”） */
  readonly consumers: readonly string[];
}

/** 环境变量名常量（代码里只允许引用这里） */
export const OBSERVABILITY_ENV = {
  ['SENTRY_DSN']: 'SENTRY_DSN',
  ['SENTRY_ENVIRONMENT']: 'SENTRY_ENVIRONMENT',
  ['SENTRY_RELEASE']: 'SENTRY_RELEASE',
  ['SENTRY_AUTH_TOKEN']: 'SENTRY_AUTH_TOKEN',
  ['SENTRY_ORG']: 'SENTRY_ORG',
  ['SENTRY_PROJECT']: 'SENTRY_PROJECT',
  ['SENTRY_UPLOAD_DISABLED']: 'SENTRY_UPLOAD_DISABLED',
  ['SENTRY_UPLOAD_DEBUG_FILES']: 'SENTRY_UPLOAD_DEBUG_FILES',
  ['OTEL_EXPORTER_OTLP_ENDPOINT']: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  ['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT']: 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  ['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']: 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  ['OTEL_EXPORTER_OTLP_HEADERS']: 'OTEL_EXPORTER_OTLP_HEADERS',
  ['OTEL_SERVICE_NAME']: 'OTEL_SERVICE_NAME',
  ['OTEL_TRACES_SAMPLER']: 'OTEL_TRACES_SAMPLER',
  ['OTEL_TRACES_SAMPLER_ARG']: 'OTEL_TRACES_SAMPLER_ARG',
  ['OTEL_LOG_LEVEL']: 'OTEL_LOG_LEVEL',
  ['OTEL_LOG_SAMPLE_RATIO']: 'OTEL_LOG_SAMPLE_RATIO',
  ['OTEL_LOG_MAX_PER_MINUTE']: 'OTEL_LOG_MAX_PER_MINUTE',
  ['OTEL_METRIC_EXPORT_INTERVAL']: 'OTEL_METRIC_EXPORT_INTERVAL',
  ['OTEL_DIAG']: 'OTEL_DIAG',
} as const;

/** 环境变量注册表（配置参考表与门禁的唯一数据源） */
export const OBSERVABILITY_ENV_ENTRIES: readonly ObservabilityEnvEntry[] = [
  {
    key: OBSERVABILITY_ENV.SENTRY_DSN,
    scopes: ['runtime', 'build'],
    defaultValue: '',
    description: 'Sentry 客户端 DSN；未配置则错误上报完整 no-op。运行时优先于构建期注入。',
    sensitive: false,
    restartRequired: true,
    consumers: ['sentry', 'electron-vite'],
  },
  {
    key: OBSERVABILITY_ENV.SENTRY_ENVIRONMENT,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'Sentry 环境名；默认 production（打包）/ development（dev）。',
    sensitive: false,
    restartRequired: true,
    consumers: ['sentry'],
  },
  {
    key: OBSERVABILITY_ENV.SENTRY_RELEASE,
    scopes: ['runtime', 'build', 'ci'],
    defaultValue: '',
    description: 'Sentry release；默认 {executableName}@{version}。运行时与上传必须一致。',
    sensitive: false,
    restartRequired: true,
    consumers: ['sentry', 'sentry-sourcemaps', 'doctor'],
  },
  {
    key: OBSERVABILITY_ENV.SENTRY_AUTH_TOKEN,
    scopes: ['build', 'ci'],
    defaultValue: '',
    description: 'Sentry source map / release 上传令牌；仅构建与 CI 使用。',
    sensitive: true,
    restartRequired: false,
    consumers: ['sentry-sourcemaps', 'sentry-debug-files'],
  },
  {
    key: OBSERVABILITY_ENV.SENTRY_ORG,
    scopes: ['build', 'ci'],
    defaultValue: '',
    description: 'Sentry 组织 slug；与 AUTH_TOKEN/PROJECT 同时存在才上传。',
    sensitive: false,
    restartRequired: false,
    consumers: ['sentry-sourcemaps', 'sentry-debug-files'],
  },
  {
    key: OBSERVABILITY_ENV.SENTRY_PROJECT,
    scopes: ['build', 'ci'],
    defaultValue: '',
    description: 'Sentry 项目 slug；与 AUTH_TOKEN/ORG 同时存在才上传。',
    sensitive: false,
    restartRequired: false,
    consumers: ['sentry-sourcemaps', 'sentry-debug-files'],
  },
  {
    key: OBSERVABILITY_ENV.SENTRY_UPLOAD_DISABLED,
    scopes: ['build', 'ci'],
    defaultValue: '',
    description: '设为 1 时跳过 source map 上传（本地构建排障用）。',
    sensitive: false,
    restartRequired: false,
    consumers: ['sentry-sourcemaps'],
  },
  {
    key: OBSERVABILITY_ENV.SENTRY_UPLOAD_DEBUG_FILES,
    scopes: ['ci'],
    defaultValue: '0',
    description: '设为 1 时上传解包目录的原生调试符号；默认关闭。',
    sensitive: false,
    restartRequired: false,
    consumers: ['sentry-debug-files'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_EXPORTER_OTLP_ENDPOINT,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'OTLP base URL；自动派生 /v1/traces|metrics|logs。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'trace 专用 OTLP 端点；优先于 base URL 派生。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'metrics 专用 OTLP 端点；优先于 base URL 派生。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'logs 专用 OTLP 端点；优先于 base URL 派生。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_EXPORTER_OTLP_HEADERS,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'OTLP 请求头（key=value,key2=value2），用于 SigNoz Cloud 等鉴权。',
    sensitive: true,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_SERVICE_NAME,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'service.name；默认 {executableName}-prod/dev。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_TRACES_SAMPLER,
    scopes: ['runtime'],
    defaultValue: '',
    description: '采样器策略（always_on / always_off / parentbased_traceidratio）。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_TRACES_SAMPLER_ARG,
    scopes: ['runtime'],
    defaultValue: '',
    description: '根 span 采样率 0..1；默认 dev=1、生产=0.2。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_LOG_LEVEL,
    scopes: ['runtime'],
    defaultValue: '',
    description: 'OTel 日志导出最低级别 debug/info/warn/error；full 默认 info。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_LOG_SAMPLE_RATIO,
    scopes: ['runtime'],
    defaultValue: '1',
    description: 'info/debug 日志随机采样率 0..1；warn/error 永不采样。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_LOG_MAX_PER_MINUTE,
    scopes: ['runtime'],
    defaultValue: '0',
    description: '非 error 日志每分钟导出上限；0 表示不限。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_METRIC_EXPORT_INTERVAL,
    scopes: ['runtime'],
    defaultValue: '60000',
    description: '指标导出间隔毫秒（1000..600000）。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
  {
    key: OBSERVABILITY_ENV.OTEL_DIAG,
    scopes: ['runtime'],
    defaultValue: '',
    description: '设为 1 时把 OTel SDK 导出错误打到 stderr（排障用）。',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
];

/** 注册表键集合（门禁/doctor 用） */
export const OBSERVABILITY_ENV_KEYS: ReadonlySet<string> = new Set(
  OBSERVABILITY_ENV_ENTRIES.map((entry) => entry.key),
);
