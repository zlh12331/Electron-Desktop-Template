import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from './rate-limit';

describe('FixedWindowRateLimiter', () => {
  it('窗口内放行到上限，超出拒绝', () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000, 1_000);
    expect(limiter.tryAcquire(1_000)).toBe(true);
    expect(limiter.tryAcquire(1_001)).toBe(true);
    expect(limiter.tryAcquire(1_002)).toBe(true);
    expect(limiter.tryAcquire(1_003)).toBe(false);
  });

  it('窗口到期后清零', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, 1_000);
    expect(limiter.tryAcquire(1_000)).toBe(true);
    expect(limiter.tryAcquire(1_999)).toBe(false);
    expect(limiter.tryAcquire(2_000)).toBe(true);
  });

  it('时钟回拨按新窗口处理（不会永久卡死）', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, 10_000);
    expect(limiter.tryAcquire(10_000)).toBe(true);
    expect(limiter.tryAcquire(9_000)).toBe(true);
  });
});
