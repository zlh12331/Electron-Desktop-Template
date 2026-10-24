import { describe, expect, it } from 'vitest';
import { ErrorEventRateLimiter } from './error-rate-limit';

describe('ErrorEventRateLimiter 内存界限', () => {
  it('跨窗口高基数输入最多保留 128 个摘要，不保留原文', () => {
    let now = 0;
    const limiter = new ErrorEventRateLimiter(() => now);
    for (let window = 0; window < 10; window += 1) {
      for (let index = 0; index < 60; index += 1) {
        expect(
          limiter.tryAcquire({
            type: undefined,
            message: `${window}-${index}-${'x'.repeat(10_000)}`,
          }),
        ).toBe(true);
      }
      now += 60_000;
      expect(limiter.fingerprintCount).toBeLessThanOrEqual(128);
    }
    expect(limiter.fingerprintCount).toBe(128);
    expect(JSON.stringify(limiter)).toBe('{}');
  });

  it('fatal 和 unhandled 不消耗正常配额，时钟回退不锁死窗口', () => {
    let now = 100_000;
    const limiter = new ErrorEventRateLimiter(() => now);
    for (let index = 0; index < 100; index += 1) {
      expect(limiter.tryAcquire({ type: undefined, level: 'fatal' })).toBe(true);
      expect(
        limiter.tryAcquire({
          type: undefined,
          exception: { values: [{ mechanism: { type: 'onerror', handled: false } }] },
        }),
      ).toBe(true);
    }
    expect(limiter.fingerprintCount).toBe(0);
    for (let index = 0; index < 5; index += 1) {
      expect(limiter.tryAcquire({ type: undefined, message: 'same' })).toBe(true);
    }
    expect(limiter.tryAcquire({ type: undefined, message: 'same' })).toBe(false);
    now = 0;
    expect(limiter.tryAcquire({ type: undefined, message: 'same' })).toBe(true);
  });
});
