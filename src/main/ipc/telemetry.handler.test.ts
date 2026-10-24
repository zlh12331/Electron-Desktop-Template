import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  level: 'full' as 'off' | 'error-only' | 'full',
  configuredLevel: null as 'off' | 'error-only' | 'full' | null,
  tryAcquire: vi.fn(() => true),
  captureRendererError: vi.fn(),
  emitOtelLog: vi.fn(),
  recordWebVital: vi.fn(() => true),
  probeOtlpEndpoints: vi.fn(
    async (): Promise<
      ReadonlyArray<{
        signal: string;
        url: string;
        ok: boolean;
        statusCode: number | null;
        message: string;
      }>
    > => [],
  ),
  sentryEnabled: true,
  otelEnabled: true,
  health: {
    traces: { attempts: 1, failures: 0, lastSuccessAt: 1, lastFailureAt: null, lastError: null },
    metrics: { attempts: 1, failures: 0, lastSuccessAt: 1, lastFailureAt: null, lastError: null },
    logs: { attempts: 1, failures: 0, lastSuccessAt: 1, lastFailureAt: null, lastError: null },
    sampledLogs: 0,
    rateLimitedLogs: 0,
    suppressedErrors: 0,
    lastDropAt: null,
  },
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.0.0' },
}));

vi.mock('../infra/storage/telemetry-pref', () => ({
  readTelemetryLevelSync: () => mocks.configuredLevel ?? mocks.level,
}));

vi.mock('../infra/telemetry/rate-limit', () => ({
  ['FixedWindowRateLimiter']: class {
    tryAcquire = mocks.tryAcquire;
  },
}));

vi.mock('../infra/telemetry/sentry', () => ({
  captureRendererError: mocks.captureRendererError,
  getSentryActiveConfig: vi.fn(() => null),
  getSentryStatus: () => ({
    enabled: mocks.sentryEnabled,
    initialized: mocks.sentryEnabled,
    reason: mocks.sentryEnabled ? null : 'no-dsn',
    release: 'app@1.0.0',
    environment: 'development',
  }),
}));

vi.mock('../infra/telemetry/otel', () => ({
  getTelemetryRuntimeStatus: () => ({
    level: mocks.level,
    enabled: mocks.otelEnabled,
    tracing: mocks.otelEnabled,
    metrics: mocks.otelEnabled,
    logs: mocks.otelEnabled,
    endpointConfigured: mocks.otelEnabled,
  }),
  getOtelActiveConfig: () => null,
}));

vi.mock('../infra/telemetry/connectivity', () => ({
  probeOtlpEndpoints: mocks.probeOtlpEndpoints,
}));

vi.mock('../infra/telemetry/telemetry-health', () => ({
  getTelemetryHealth: () => mocks.health,
}));

vi.mock('../infra/telemetry/otel-log', () => ({
  emitOtelLog: mocks.emitOtelLog,
}));

vi.mock('../infra/telemetry/otel-metrics', () => ({
  recordWebVital: mocks.recordWebVital,
}));

import { TelemetryStatusResSchema } from '@code-agent/shared/main';
import { getSentryActiveConfig } from '../infra/telemetry/sentry';
import { telemetryHandlers } from './telemetry.handler';

const input = {
  message: 'renderer boom',
  name: 'TypeError',
  stack: 'TypeError: renderer boom\n at app.tsx:1:1',
  tags: { boundary: 'SectionErrorBoundary' },
};

const ctx = { traceId: 'trace-123', sender: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.level = 'full';
  mocks.configuredLevel = null;
  vi.mocked(getSentryActiveConfig).mockReturnValue(null);
  mocks.tryAcquire.mockReturnValue(true);
  mocks.recordWebVital.mockReturnValue(true);
  mocks.sentryEnabled = true;
  mocks.otelEnabled = true;
  mocks.probeOtlpEndpoints.mockResolvedValue([]);
  delete process.env['SENTRY_DSN'];
  delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
});

describe('telemetry.captureError', () => {
  it('遥测 off：不转发、不占用限流配额', async () => {
    mocks.level = 'off';
    await expect(telemetryHandlers.captureError(input, ctx)).resolves.toEqual({ accepted: false });
    expect(mocks.tryAcquire).not.toHaveBeenCalled();
    expect(mocks.captureRendererError).not.toHaveBeenCalled();
  });

  it('限流命中：返回 accepted=false 且不转发', async () => {
    mocks.tryAcquire.mockReturnValue(false);
    await expect(telemetryHandlers.captureError(input, ctx)).resolves.toEqual({ accepted: false });
    expect(mocks.emitOtelLog).not.toHaveBeenCalled();
    expect(mocks.captureRendererError).not.toHaveBeenCalled();
  });

  it('正常路径：OTel 日志 + Sentry 同步转发（带 traceId）', async () => {
    await expect(telemetryHandlers.captureError(input, ctx)).resolves.toEqual({ accepted: true });
    expect(mocks.emitOtelLog).toHaveBeenCalledWith(
      'error',
      {
        boundary: 'SectionErrorBoundary',
        traceId: 'trace-123',
        processType: 'renderer',
        scope: 'renderer.error',
      },
      '渲染层错误上报',
      expect.any(Error),
    );
    expect(mocks.captureRendererError).toHaveBeenCalledWith(input, 'trace-123');
  });
});

describe('telemetry.reportWebVitals', () => {
  it('指标可接收：逐条记录并返回接收条数', async () => {
    const result = await telemetryHandlers.reportWebVitals(
      {
        metrics: [
          { name: 'LCP', value: 2500, rating: 'good', navigationType: 'navigate' },
          { name: 'CLS', value: 0.05 },
        ],
      },
      ctx,
    );
    expect(result).toEqual({ accepted: 2 });
    expect(mocks.recordWebVital).toHaveBeenCalledWith('LCP', 2500, {
      rating: 'good',
      navigationType: 'navigate',
    });
    expect(mocks.recordWebVital).toHaveBeenCalledWith('CLS', 0.05, {});
  });

  it('metrics 未启用：返回 accepted=0', async () => {
    mocks.recordWebVital.mockReturnValue(false);
    const result = await telemetryHandlers.reportWebVitals(
      { metrics: [{ name: 'INP', value: 120 }] },
      ctx,
    );
    expect(result).toEqual({ accepted: 0 });
  });
});

describe('telemetry.getStatus', () => {
  it('保存偏好不同于活动级别时标记待重启，响应符合共享契约', async () => {
    mocks.configuredLevel = 'off';
    const result = await telemetryHandlers.getStatus(undefined, ctx);
    expect(result).toMatchObject({ level: 'full', configuredLevel: 'off', restartRequired: true });
    expect(TelemetryStatusResSchema.safeParse(result).success).toBe(true);
  });

  it('组合 Sentry/OTel/health 快照', async () => {
    await expect(telemetryHandlers.getStatus(undefined, ctx)).resolves.toMatchObject({
      level: 'full',
      sentry: { enabled: true, release: 'app@1.0.0' },
      otel: { enabled: true, tracing: true },
      health: mocks.health,
    });
  });
});

describe('telemetry.testConnection', () => {
  it('复用含构建 DSN 的启动配置，不误报未配置或发送测试事件', async () => {
    vi.mocked(getSentryActiveConfig).mockReturnValue({
      enabled: true,
      reason: null,
      dsn: 'https://public@example.invalid/1',
      release: 'app@1.0.0',
      environment: 'production',
    });
    const result = await telemetryHandlers.testConnection(undefined, ctx);
    expect(result.sentry).toMatchObject({ configured: true, valid: true });
    expect(mocks.captureRendererError).not.toHaveBeenCalled();
  });

  it('OTLP 端点：真实探测结果聚合', async () => {
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://127.0.0.1:4318';
    mocks.probeOtlpEndpoints.mockResolvedValue([
      {
        signal: 'traces',
        url: 'http://127.0.0.1:4318/v1/traces',
        ok: true,
        statusCode: 200,
        message: '可达',
      },
      {
        signal: 'metrics',
        url: 'http://127.0.0.1:4318/v1/metrics',
        ok: false,
        statusCode: null,
        message: 'refused',
      },
      {
        signal: 'logs',
        url: 'http://127.0.0.1:4318/v1/logs',
        ok: true,
        statusCode: 200,
        message: '可达',
      },
    ]);
    const result = await telemetryHandlers.testConnection(undefined, ctx);
    expect(result.otlp).toMatchObject({
      checked: true,
      reason: 'probed',
      message: '2/3 个端点可达',
    });
    expect(result.otlp.results).toHaveLength(3);
    expect(result.sentry).toMatchObject({ configured: false, valid: false, message: '未配置 DSN' });
  });

  it('遥测 off：不探测 OTLP', async () => {
    mocks.level = 'off';
    const result = await telemetryHandlers.testConnection(undefined, ctx);
    expect(result.otlp).toEqual({
      checked: false,
      reason: 'off',
      message: '遥测级别 off，未探测 OTLP',
      results: [],
    });
    expect(mocks.probeOtlpEndpoints).not.toHaveBeenCalled();
  });

  it('限流：返回空探测结果', async () => {
    mocks.tryAcquire.mockReturnValue(false);
    const result = await telemetryHandlers.testConnection(undefined, ctx);
    expect(result.otlp).toMatchObject({
      checked: false,
      reason: 'rate-limited',
      message: '请求过于频繁，请稍后再试',
    });
  });
});
