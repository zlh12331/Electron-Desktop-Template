import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const mockApp = {
    isPackaged: false,
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp/otel-test'),
    getAppMetrics: vi.fn(() => []),
  };
  const mockSetLogSink = vi.fn();
  return { mockLogger, mockApp, mockSetLogSink };
});

vi.mock('electron', () => ({
  app: mocks.mockApp,
}));

vi.mock('../../utils/logger', () => ({
  logger: mocks.mockLogger,
  setLogSink: mocks.mockSetLogSink,
}));

// 单测不碰网络：三个 OTLP exporter 全部换成同步成功的 no-op 实现
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  ['OTLPTraceExporter']: class {
    export(_items: unknown, callback: (result: { code: number }) => void): void {
      callback({ code: 0 });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
    forceFlush(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  ['OTLPMetricExporter']: class {
    export(_items: unknown, callback: (result: { code: number }) => void): void {
      callback({ code: 0 });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
    forceFlush(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  ['OTLPLogExporter']: class {
    export(_items: unknown, callback: (result: { code: number }) => void): void {
      callback({ code: 0 });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
    forceFlush(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

import {
  getTelemetryRuntimeStatus,
  getTracer,
  initTelemetry,
  shutdownTelemetry,
  withSpan,
} from './otel';

const ENDPOINT_KEY = 'OTEL_EXPORTER_OTLP_ENDPOINT';

describe('OpenTelemetry 初始化与生命周期', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockApp.isPackaged = false;
    delete process.env[ENDPOINT_KEY];
    delete process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'];
    delete process.env['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'];
    delete process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'];
    delete process.env['OTEL_TRACES_SAMPLER_ARG'];
    delete process.env['OTEL_LOG_LEVEL'];
    await shutdownTelemetry();
  });

  it('遥测 off：不初始化，状态保持关闭', () => {
    initTelemetry('off');
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      {},
      'OpenTelemetry 未初始化（遥测级别 = off）',
    );
    expect(getTracer()).toBeNull();
    expect(getTelemetryRuntimeStatus()).toMatchObject({ level: 'off', enabled: false });
  });

  it('打包版无端点：完整 no-op（不外发、不落 console）', () => {
    mocks.mockApp.isPackaged = true;
    initTelemetry('full');
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      {},
      'OpenTelemetry 未初始化（打包版未配置 OTLP 端点）',
    );
    expect(getTracer()).toBeNull();
    expect(getTelemetryRuntimeStatus()).toMatchObject({
      level: 'full',
      enabled: false,
      tracing: false,
      metrics: false,
      logs: false,
    });
  });

  it('dev 无端点：仅 Console trace，metrics/logs 关闭', () => {
    initTelemetry('full');
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      {},
      'OpenTelemetry 初始化完成（Console exporter，dev only）',
    );
    expect(getTracer()).not.toBeNull();
    expect(getTelemetryRuntimeStatus()).toMatchObject({
      enabled: true,
      tracing: true,
      metrics: false,
      logs: false,
      endpointConfigured: false,
    });
  });

  it('full + 端点：trace/metrics/logs 三路都启用', () => {
    process.env[ENDPOINT_KEY] = 'http://127.0.0.1:9';
    initTelemetry('full');
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tracing: true, metrics: true, logs: true, traceSampleRatio: 1 }),
      'OpenTelemetry 初始化完成（OTLP exporter）',
    );
    expect(getTelemetryRuntimeStatus()).toMatchObject({
      enabled: true,
      tracing: true,
      metrics: true,
      logs: true,
      endpointConfigured: true,
    });
    expect(mocks.mockSetLogSink).toHaveBeenCalledWith(expect.any(Function));
  });

  it('error-only + 端点：只启用日志导出（trace/metrics 交给 Sentry）', () => {
    process.env[ENDPOINT_KEY] = 'http://127.0.0.1:9';
    initTelemetry('error-only');
    expect(getTracer()).toBeNull();
    expect(getTelemetryRuntimeStatus()).toMatchObject({
      level: 'error-only',
      enabled: true,
      tracing: false,
      metrics: false,
      logs: true,
    });
  });

  it('error-only 且 dev 无端点：完全 no-op（没有可导出的日志后端）', () => {
    initTelemetry('error-only');
    expect(getTelemetryRuntimeStatus().enabled).toBe(false);
    expect(getTracer()).toBeNull();
  });

  it('采样比例可配置：OTEL_TRACES_SAMPLER_ARG 生效', () => {
    process.env[ENDPOINT_KEY] = 'http://127.0.0.1:9';
    process.env['OTEL_TRACES_SAMPLER_ARG'] = '0.25';
    initTelemetry('full');
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ traceSampleRatio: 0.25 }),
      'OpenTelemetry 初始化完成（OTLP exporter）',
    );
  });

  it('幂等：重复初始化返回同一 tracer', () => {
    initTelemetry('full');
    const first = getTracer();
    initTelemetry('full');
    expect(getTracer()).toBe(first);
  });

  it('withSpan：未初始化时仍传入可调用的 no-op Span', async () => {
    let spanDefined = false;
    const result = await withSpan('test.span', {}, async (span) => {
      spanDefined = true;
      span.setAttribute('x', 1);
      return 'ok';
    });
    expect(spanDefined).toBe(true);
    expect(result).toBe('ok');
  });

  it('withSpan：fn 抛错时原样向上抛出', async () => {
    process.env[ENDPOINT_KEY] = 'http://127.0.0.1:9';
    initTelemetry('full');
    await expect(
      withSpan('test.fail', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('withSpan：isError 把业务失败标成错误状态但不抛异常', async () => {
    const result = await withSpan(
      'ipc test',
      {},
      async () => ({ error: { code: 'INVALID_INPUT' } }),
      (value) => (value.error === undefined ? null : value.error.code),
    );
    expect(result).toEqual({ error: { code: 'INVALID_INPUT' } });
  });

  it('shutdown：重置 tracer 与状态', async () => {
    initTelemetry('full');
    expect(getTracer()).not.toBeNull();
    await shutdownTelemetry();
    expect(getTracer()).toBeNull();
    expect(mocks.mockSetLogSink).toHaveBeenCalledWith(null);
    expect(getTelemetryRuntimeStatus()).toMatchObject({
      level: 'off',
      enabled: false,
      tracing: false,
      metrics: false,
      logs: false,
    });
  });

  it('shutdown 未初始化：直接返回', async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
