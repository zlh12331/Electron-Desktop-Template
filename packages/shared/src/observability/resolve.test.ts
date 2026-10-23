// biome-ignore-all lint/style/useNamingConvention: 测试直接构造 OTEL_*/SENTRY_* 标准环境变量键
import { describe, expect, it } from 'vitest';

import {
  deriveSignalEndpoint,
  maskSentryDsn,
  parseSentryDsn,
  resolveMetricExportInterval,
  resolveObservabilityConfig,
  resolveOtelConfig,
  resolveOtelLogMaxPerMinute,
  resolveOtelLogSampleRatio,
  resolveOtlpHeaders,
  resolveSentryConfig,
  resolveSentryDsn,
  resolveSentryRelease,
  resolveSentryUploadConfig,
  validateHttpEndpoint,
} from './resolve';

const baseEnv = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };

describe('端点与请求头', () => {
  it('base URL 补 /v1/{signal}', () => {
    expect(deriveSignalEndpoint('http://127.0.0.1:4318', 'traces')).toBe(
      'http://127.0.0.1:4318/v1/traces',
    );
    expect(deriveSignalEndpoint('http://127.0.0.1:4318/', 'metrics')).toBe(
      'http://127.0.0.1:4318/v1/metrics',
    );
  });

  it('已含信号路径时替换为当前信号', () => {
    expect(deriveSignalEndpoint('https://otlp.example.com/v1/traces', 'logs')).toBe(
      'https://otlp.example.com/v1/logs',
    );
  });

  it('带子路径的 base 保留前缀', () => {
    expect(deriveSignalEndpoint('https://example.com/tenant/otlp', 'traces')).toBe(
      'https://example.com/tenant/otlp/v1/traces',
    );
  });

  it('解析 key=value 列表并忽略空白/非法片段', () => {
    expect(resolveOtlpHeaders('signoz-access-token=abc, x-tenant = t1 ,broken,')).toEqual({
      'signoz-access-token': 'abc',
      'x-tenant': 't1',
    });
  });
});

describe('resolveOtelConfig', () => {
  it('off：完全禁用', () => {
    const config = resolveOtelConfig({}, { isPackaged: true, level: 'off' });
    expect(config.enabled).toBe(false);
    expect(config.traceEndpoint).toBeNull();
    expect(config.metricEndpoint).toBeNull();
    expect(config.logEndpoint).toBeNull();
  });

  it('full 且打包版无端点：禁用', () => {
    const config = resolveOtelConfig({}, { isPackaged: true, level: 'full' });
    expect(config).toMatchObject({
      enabled: false,
      consoleTracing: false,
      traceEndpoint: null,
      metricEndpoint: null,
      logEndpoint: null,
      serviceName: 'electron-desktop-template-prod',
    });
  });

  it('full 且 dev 无端点：console trace only', () => {
    const config = resolveOtelConfig({}, { isPackaged: false, level: 'full' });
    expect(config).toMatchObject({
      enabled: true,
      consoleTracing: true,
      traceEndpoint: null,
      metricEndpoint: null,
      logEndpoint: null,
      traceSampleRatio: 1,
      logMinLevel: 'info',
      logSampleRatio: 1,
      logMaxPerMinute: 0,
      serviceName: 'electron-desktop-template-dev',
    });
  });

  it('full + base 端点：三路端点自动派生 + 打包版默认采样 0.2', () => {
    const config = resolveOtelConfig(baseEnv, { isPackaged: true, level: 'full' });
    expect(config).toMatchObject({
      enabled: true,
      consoleTracing: false,
      traceEndpoint: 'http://127.0.0.1:4318/v1/traces',
      metricEndpoint: 'http://127.0.0.1:4318/v1/metrics',
      logEndpoint: 'http://127.0.0.1:4318/v1/logs',
      traceSampleRatio: 0.2,
    });
  });

  it('信号专用端点覆盖 base 派生', () => {
    const config = resolveOtelConfig(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://traces.example.com/v1/traces',
      },
      { isPackaged: true, level: 'full' },
    );
    expect(config.traceEndpoint).toBe('https://traces.example.com/v1/traces');
    expect(config.metricEndpoint).toBe('http://127.0.0.1:4318/v1/metrics');
  });

  it('error-only + 端点：只保留 logs', () => {
    const config = resolveOtelConfig(baseEnv, { isPackaged: true, level: 'error-only' });
    expect(config).toMatchObject({
      enabled: true,
      traceEndpoint: null,
      metricEndpoint: null,
      logEndpoint: 'http://127.0.0.1:4318/v1/logs',
      logMinLevel: 'error',
    });
  });

  it('error-only + dev 无端点：禁用', () => {
    expect(resolveOtelConfig({}, { isPackaged: false, level: 'error-only' }).enabled).toBe(false);
  });

  it('error-only 只有 trace/metrics 端点：禁用（没有日志后端）', () => {
    const config = resolveOtelConfig(
      { OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/v1/metrics' },
      { isPackaged: true, level: 'error-only' },
    );
    expect(config.enabled).toBe(false);
    expect(config.logEndpoint).toBeNull();
  });

  it('采样参数：always_off / always_on / 非法值回落', () => {
    expect(
      resolveOtelConfig(
        { ...baseEnv, OTEL_TRACES_SAMPLER: 'always_off' },
        { isPackaged: true, level: 'full' },
      ).traceSampleRatio,
    ).toBe(0);
    expect(
      resolveOtelConfig(
        { ...baseEnv, OTEL_TRACES_SAMPLER: 'always_on' },
        { isPackaged: true, level: 'full' },
      ).traceSampleRatio,
    ).toBe(1);
    expect(
      resolveOtelConfig(
        { ...baseEnv, OTEL_TRACES_SAMPLER_ARG: '9' },
        { isPackaged: true, level: 'full' },
      ).traceSampleRatio,
    ).toBe(0.2);
  });

  it('日志级别/采样/限流解析', () => {
    expect(
      resolveOtelConfig({ ...baseEnv, OTEL_LOG_LEVEL: 'warn' }, { isPackaged: true, level: 'full' })
        .logMinLevel,
    ).toBe('warn');
    expect(
      resolveOtelConfig(
        { ...baseEnv, OTEL_LOG_LEVEL: 'warn' },
        { isPackaged: true, level: 'error-only' },
      ).logMinLevel,
    ).toBe('error');
    expect(
      resolveOtelConfig(
        { ...baseEnv, OTEL_LOG_LEVEL: 'nonsense' },
        { isPackaged: true, level: 'full' },
      ).logMinLevel,
    ).toBe('info');
    expect(resolveOtelLogSampleRatio({ OTEL_LOG_SAMPLE_RATIO: '0.5' })).toBe(0.5);
    expect(resolveOtelLogSampleRatio({ OTEL_LOG_SAMPLE_RATIO: '5' })).toBe(1);
    expect(resolveOtelLogMaxPerMinute({ OTEL_LOG_MAX_PER_MINUTE: '120' })).toBe(120);
    expect(resolveOtelLogMaxPerMinute({ OTEL_LOG_MAX_PER_MINUTE: '-1' })).toBe(0);
  });

  it('指标导出间隔：默认 60000，越界收敛', () => {
    expect(resolveMetricExportInterval({})).toBe(60_000);
    expect(resolveMetricExportInterval({ OTEL_METRIC_EXPORT_INTERVAL: '100' })).toBe(1_000);
    expect(resolveMetricExportInterval({ OTEL_METRIC_EXPORT_INTERVAL: '99999999' })).toBe(600_000);
  });

  it('OTEL_SERVICE_NAME 覆盖默认服务名；headers 解析', () => {
    const config = resolveOtelConfig(
      {
        OTEL_SERVICE_NAME: 'my-app',
        ...baseEnv,
        OTEL_EXPORTER_OTLP_HEADERS: 'signoz-access-token=secret',
      },
      { isPackaged: true, level: 'full' },
    );
    expect(config.serviceName).toBe('my-app');
    expect(config.headers).toEqual({ 'signoz-access-token': 'secret' });
  });
});

describe('Sentry 配置', () => {
  it('release 默认 {可执行名}@{版本}，可被覆盖', () => {
    expect(resolveSentryRelease({}, 'app', '1.2.3')).toBe('app@1.2.3');
    expect(resolveSentryRelease({ SENTRY_RELEASE: 'custom@2.0.0' }, 'app', '1.2.3')).toBe(
      'custom@2.0.0',
    );
  });

  it('DSN 运行时优先于构建期；空串视为未配置', () => {
    expect(resolveSentryDsn({ SENTRY_DSN: 'https://runtime' }, 'https://build')).toBe(
      'https://runtime',
    );
    expect(resolveSentryDsn({ SENTRY_DSN: '  ' }, 'https://build')).toBe('https://build');
    expect(resolveSentryDsn({}, '')).toBe('');
  });

  it('级别 off / 无 DSN 的禁用原因', () => {
    expect(
      resolveSentryConfig({}, { isPackaged: true, level: 'off', version: '1.0.0' }),
    ).toMatchObject({ enabled: false, reason: 'telemetry-off' });
    expect(
      resolveSentryConfig({}, { isPackaged: true, level: 'full', version: '1.0.0' }),
    ).toMatchObject({ enabled: false, reason: 'no-dsn' });
  });

  it('有 DSN：release/environment 正确', () => {
    const config = resolveSentryConfig(
      { SENTRY_DSN: 'https://key@example.com/1' },
      { isPackaged: false, level: 'full', version: '1.2.3', executableName: 'app' },
    );
    expect(config).toMatchObject({
      enabled: true,
      reason: null,
      dsn: 'https://key@example.com/1',
      release: 'app@1.2.3',
      environment: 'development',
    });
  });

  it('上传配置：凭据齐全/缺失/显式禁用', () => {
    const complete = {
      SENTRY_AUTH_TOKEN: 'token',
      SENTRY_ORG: 'org',
      SENTRY_PROJECT: 'project',
    };
    const ready = resolveSentryUploadConfig(complete, 'app', '1.2.3', 'out');
    expect(ready).toMatchObject({ release: 'app@1.2.3', skipReason: null, missingCredentials: [] });

    const partial = resolveSentryUploadConfig(
      { SENTRY_AUTH_TOKEN: 'token' },
      'app',
      '1.2.3',
      'out',
    );
    expect(partial.missingCredentials).toEqual(['SENTRY_ORG', 'SENTRY_PROJECT']);
    expect(partial.skipReason).toBe('缺少 SENTRY_ORG / SENTRY_PROJECT');

    const disabled = resolveSentryUploadConfig(
      { ...complete, SENTRY_UPLOAD_DISABLED: '1' },
      'app',
      '1.2.3',
      'out',
    );
    expect(disabled.skipReason).toBe('SENTRY_UPLOAD_DISABLED=1');
  });

  it('组合配置同时包含 Sentry 与 OTel', () => {
    const config = resolveObservabilityConfig(
      { SENTRY_DSN: 'https://key@example.com/1', ...baseEnv },
      { isPackaged: true, level: 'full', version: '1.0.0', executableName: 'app' },
    );
    expect(config.level).toBe('full');
    expect(config.sentry.enabled).toBe(true);
    expect(config.otel.enabled).toBe(true);
  });
});

describe('配置校验辅助', () => {
  it('HTTP(S) URL 校验', () => {
    expect(validateHttpEndpoint('http://127.0.0.1:4318')).toBeNull();
    expect(validateHttpEndpoint('https://example.com/v1/traces')).toBeNull();
    expect(validateHttpEndpoint('ftp://example.com')).toBe('仅支持 http/https');
    expect(validateHttpEndpoint('not a url')).toBe('URL 格式无效');
  });

  it('DSN 结构校验与脱敏', () => {
    const valid = parseSentryDsn('https://public@example.com/42');
    expect(valid).toMatchObject({ valid: true, host: 'example.com', projectId: '42' });
    expect(maskSentryDsn('https://public@example.com/42')).toBe('https://***@example.com/42');
    expect(parseSentryDsn('not-a-dsn').valid).toBe(false);
    expect(maskSentryDsn('not-a-dsn')).toBe('<invalid>');
  });
});
