import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  level: 'full' as 'off' | 'error-only' | 'full',
  tryAcquire: vi.fn(() => true),
  captureRendererError: vi.fn(),
  emitOtelLog: vi.fn(),
  recordWebVital: vi.fn(() => true),
}));

vi.mock('../infra/storage/telemetry-pref', () => ({
  readTelemetryLevelSync: () => mocks.level,
}));

vi.mock('../infra/telemetry/rate-limit', () => ({
  ['FixedWindowRateLimiter']: class {
    tryAcquire = mocks.tryAcquire;
  },
}));

vi.mock('../infra/telemetry/sentry', () => ({
  captureRendererError: mocks.captureRendererError,
}));

vi.mock('../infra/telemetry/otel-log', () => ({
  emitOtelLog: mocks.emitOtelLog,
}));

vi.mock('../infra/telemetry/otel-metrics', () => ({
  recordWebVital: mocks.recordWebVital,
}));

import { telemetryHandlers } from './telemetry.handler';

const input = {
  message: 'renderer boom',
  name: 'TypeError',
  stack: 'TypeError: renderer boom\n at app.tsx:1:1',
  tags: { boundary: 'SectionErrorBoundary' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.level = 'full';
  mocks.tryAcquire.mockReturnValue(true);
  mocks.recordWebVital.mockReturnValue(true);
});

describe('telemetry.captureError', () => {
  it('遥测 off：不转发、不占用限流配额', async () => {
    mocks.level = 'off';
    await expect(telemetryHandlers.captureError(input, {} as never)).resolves.toEqual({
      accepted: false,
    });
    expect(mocks.tryAcquire).not.toHaveBeenCalled();
    expect(mocks.captureRendererError).not.toHaveBeenCalled();
  });

  it('限流命中：返回 accepted=false 且不转发', async () => {
    mocks.tryAcquire.mockReturnValue(false);
    await expect(telemetryHandlers.captureError(input, {} as never)).resolves.toEqual({
      accepted: false,
    });
    expect(mocks.emitOtelLog).not.toHaveBeenCalled();
    expect(mocks.captureRendererError).not.toHaveBeenCalled();
  });

  it('正常路径：OTel 日志 + Sentry 同步转发', async () => {
    await expect(telemetryHandlers.captureError(input, {} as never)).resolves.toEqual({
      accepted: true,
    });
    expect(mocks.emitOtelLog).toHaveBeenCalledWith(
      'error',
      { boundary: 'SectionErrorBoundary', processType: 'renderer', scope: 'renderer.error' },
      '渲染层错误上报',
      expect.any(Error),
    );
    expect(mocks.captureRendererError).toHaveBeenCalledWith(input);
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
      {} as never,
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
      {} as never,
    );
    expect(result).toEqual({ accepted: 0 });
  });
});
