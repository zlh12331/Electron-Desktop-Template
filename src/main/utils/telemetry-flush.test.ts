import { describe, expect, it, vi } from 'vitest';

import { flushTelemetryOnFatal, registerTelemetryFlush } from './telemetry-flush';

describe('telemetry-flush', () => {
  it('未注册时 flush 为 no-op', () => {
    expect(() => flushTelemetryOnFatal()).not.toThrow();
  });

  it('注册后返回可等待的 Promise，实现异常被吞掉', async () => {
    const impl = vi.fn(async () => {
      throw new Error('flush failed');
    });
    registerTelemetryFlush(impl);
    const pending = flushTelemetryOnFatal(321);
    expect(impl).toHaveBeenCalledWith(321);
    await expect(pending).resolves.toBeUndefined();
  });
});
