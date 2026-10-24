import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metric } from 'web-vitals';

const mocks = vi.hoisted(() => ({
  callbacks: new Map<string, (metric: unknown) => void>(),
}));

vi.mock('web-vitals', () => ({
  ['onCLS']: (callback: (metric: unknown) => void) => mocks.callbacks.set('CLS', callback),
  ['onFCP']: (callback: (metric: unknown) => void) => mocks.callbacks.set('FCP', callback),
  ['onINP']: (callback: (metric: unknown) => void) => mocks.callbacks.set('INP', callback),
  ['onLCP']: (callback: (metric: unknown) => void) => mocks.callbacks.set('LCP', callback),
  ['onTTFB']: (callback: (metric: unknown) => void) => mocks.callbacks.set('TTFB', callback),
}));

import { initWebVitals } from './web-vitals';

function metric(name: Metric['name'], value: number): Metric {
  return {
    name,
    value,
    rating: 'good',
    delta: value,
    navigationType: 'navigate',
    id: `${name}-1`,
    entries: [],
    entryType: name.toLowerCase(),
  } as unknown as Metric;
}

function trigger(name: Metric['name'], value = 100): void {
  const callback = mocks.callbacks.get(name);
  if (callback === undefined) {
    throw new Error(`callback ${name} 未注册`);
  }
  callback(metric(name, value));
}

function reportSpy(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({ data: { accepted: 1 } }));
  (window.api.telemetry as unknown as { reportWebVitals: unknown }).reportWebVitals = spy;
  return spy;
}

beforeEach(() => {
  mocks.callbacks.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('initWebVitals', () => {
  it('无 IPC 桥：不注册任何监听', () => {
    (window as unknown as { api: undefined }).api = undefined;
    initWebVitals();
    expect(mocks.callbacks.size).toBe(0);
  });

  it('preload 缺少 telemetry 域：不注册监听', () => {
    (window.api as unknown as { telemetry: undefined }).telemetry = undefined;
    initWebVitals();
    expect(mocks.callbacks.size).toBe(0);
  });

  it('注册五项指标；定时 5s flush 一次', async () => {
    const spy = reportSpy();
    initWebVitals();
    expect([...mocks.callbacks.keys()].sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

    trigger('LCP', 2500);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(spy).toHaveBeenCalledWith({
      metrics: [
        {
          name: 'LCP',
          value: 2500,
          rating: 'good',
          delta: 2500,
          navigationType: 'navigate',
        },
      ],
    });
  });

  it('满 10 条立即 flush（不等定时器）', () => {
    const spy = reportSpy();
    initWebVitals();
    for (let i = 0; i < 10; i += 1) {
      trigger('INP', i);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0]?.[0] as { metrics: unknown[] } | undefined;
    expect(payload?.metrics).toHaveLength(10);
  });

  it('pagehide：立即 flush 当前批次', () => {
    const spy = reportSpy();
    initWebVitals();
    trigger('CLS', 0.02);
    window.dispatchEvent(new Event('pagehide'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('visibilitychange → hidden：立即 flush', () => {
    const spy = reportSpy();
    initWebVitals();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    trigger('TTFB', 120);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('上报失败被吞掉（页面生命周期不受影响）', async () => {
    const spy = reportSpy();
    spy.mockRejectedValueOnce(new Error('ipc down'));
    initWebVitals();
    trigger('FCP', 300);
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
