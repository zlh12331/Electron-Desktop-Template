// biome-ignore-all lint/style/useNamingConvention: 测试直接构造 OTEL_* 标准环境变量键
import { describe, expect, it } from 'vitest';

import { deriveSignalEndpoint, resolveOtelConfig, resolveOtlpHeaders } from './otel-config';

describe('deriveSignalEndpoint', () => {
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
});

describe('resolveOtlpHeaders', () => {
  it('解析 key=value 列表并忽略空白/非法片段', () => {
    expect(resolveOtlpHeaders('signoz-access-token=abc, x-tenant = t1 ,broken,')).toEqual({
      'signoz-access-token': 'abc',
      'x-tenant': 't1',
    });
  });

  it('空串返回空对象', () => {
    expect(resolveOtlpHeaders('')).toEqual({});
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
      serviceName: 'electron-desktop-template-dev',
    });
  });

  it('full + base 端点：三路端点自动派生 + 打包版默认采样 0.2', () => {
    const config = resolveOtelConfig(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' },
      { isPackaged: true, level: 'full' },
    );
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

  it('error-only + 端点：只保留 logs，trace/metrics 关闭', () => {
    const config = resolveOtelConfig(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' },
      { isPackaged: true, level: 'error-only' },
    );
    expect(config.enabled).toBe(true);
    expect(config.traceEndpoint).toBeNull();
    expect(config.metricEndpoint).toBeNull();
    expect(config.logEndpoint).toBe('http://127.0.0.1:4318/v1/logs');
    expect(config.logMinLevel).toBe('error');
  });

  it('error-only + dev 无端点：禁用（无后端可导出）', () => {
    const config = resolveOtelConfig({}, { isPackaged: false, level: 'error-only' });
    expect(config.enabled).toBe(false);
  });

  it('采样参数：always_off / always_on / 非法值回落', () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };
    expect(
      resolveOtelConfig(
        { ...base, OTEL_TRACES_SAMPLER: 'always_off' },
        {
          isPackaged: true,
          level: 'full',
        },
      ).traceSampleRatio,
    ).toBe(0);
    expect(
      resolveOtelConfig(
        { ...base, OTEL_TRACES_SAMPLER: 'always_on' },
        {
          isPackaged: true,
          level: 'full',
        },
      ).traceSampleRatio,
    ).toBe(1);
    expect(
      resolveOtelConfig(
        { ...base, OTEL_TRACES_SAMPLER_ARG: '9' },
        {
          isPackaged: true,
          level: 'full',
        },
      ).traceSampleRatio,
    ).toBe(0.2);
  });

  it('日志级别：OTEL_LOG_LEVEL 覆盖 full 默认值，error-only 固定 error', () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };
    expect(
      resolveOtelConfig({ ...base, OTEL_LOG_LEVEL: 'warn' }, { isPackaged: true, level: 'full' })
        .logMinLevel,
    ).toBe('warn');
    expect(
      resolveOtelConfig(
        { ...base, OTEL_LOG_LEVEL: 'warn' },
        {
          isPackaged: true,
          level: 'error-only',
        },
      ).logMinLevel,
    ).toBe('error');
    expect(
      resolveOtelConfig(
        { ...base, OTEL_LOG_LEVEL: 'nonsense' },
        {
          isPackaged: true,
          level: 'full',
        },
      ).logMinLevel,
    ).toBe('info');
  });

  it('指标导出间隔：默认 60000，越界收敛到 1000..600000', () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };
    expect(
      resolveOtelConfig(base, { isPackaged: true, level: 'full' }).metricExportIntervalMs,
    ).toBe(60_000);
    expect(
      resolveOtelConfig(
        { ...base, OTEL_METRIC_EXPORT_INTERVAL: '100' },
        {
          isPackaged: true,
          level: 'full',
        },
      ).metricExportIntervalMs,
    ).toBe(1_000);
    expect(
      resolveOtelConfig(
        { ...base, OTEL_METRIC_EXPORT_INTERVAL: '99999999' },
        {
          isPackaged: true,
          level: 'full',
        },
      ).metricExportIntervalMs,
    ).toBe(600_000);
  });

  it('OTEL_SERVICE_NAME 覆盖默认服务名；headers 解析', () => {
    const config = resolveOtelConfig(
      {
        OTEL_SERVICE_NAME: 'my-app',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
        OTEL_EXPORTER_OTLP_HEADERS: 'signoz-access-token=secret',
      },
      { isPackaged: true, level: 'full' },
    );
    expect(config.serviceName).toBe('my-app');
    expect(config.headers).toEqual({ 'signoz-access-token': 'secret' });
  });
});
