import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushTelemetryOnFatal, registerTelemetryFlush } from './telemetry-flush';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const unregister of cleanup.splice(0)) {
    unregister();
  }
  vi.useRealTimers();
});

describe('telemetry-flush', () => {
  it('未注册返回 null，注销后恢复快速路径', async () => {
    expect(flushTelemetryOnFatal()).toBeNull();
    const remove = registerTelemetryFlush('sentry', () => {});
    cleanup.push(remove);
    await expect(flushTelemetryOnFatal()).resolves.toBeUndefined();
    remove();
    expect(flushTelemetryOnFatal()).toBeNull();
  });

  it('同步抛错和异步拒绝相互隔离', async () => {
    const sentry = vi.fn(() => {
      throw new Error('sync failure');
    });
    const otel = vi.fn(async () => {
      throw new Error('async failure');
    });
    cleanup.push(registerTelemetryFlush('sentry', sentry), registerTelemetryFlush('otel', otel));
    await expect(flushTelemetryOnFatal(321)).resolves.toBeUndefined();
    expect(sentry).toHaveBeenCalledWith(321);
    expect(otel).toHaveBeenCalledWith(321);
  });

  it('挂起实现共享总时限，而非串行各等待一次', async () => {
    vi.useFakeTimers();
    const hang = (): Promise<void> => new Promise(() => {});
    cleanup.push(registerTelemetryFlush('sentry', hang), registerTelemetryFlush('otel', hang));
    const done = vi.fn();
    const pending = flushTelemetryOnFatal(100)?.then(done);
    await vi.advanceTimersByTimeAsync(99);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('旧注销函数不移除新注册，同一个实现也按注册身份区分', async () => {
    const impl = vi.fn(async () => {});
    const old = registerTelemetryFlush('otel', impl);
    cleanup.push(old, registerTelemetryFlush('otel', impl));
    old();
    await flushTelemetryOnFatal();
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
