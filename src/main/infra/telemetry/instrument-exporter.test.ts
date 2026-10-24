import { beforeEach, describe, expect, it, vi } from 'vitest';

import { instrumentExporter } from './instrument-exporter';
import { getTelemetryHealth, resetTelemetryHealth } from './telemetry-health';

interface FakeExporter {
  export(items: unknown, callback: (result: { code: number; error?: Error }) => void): void;
}

function createExporter(result: { code: number; error?: Error }): FakeExporter {
  return {
    export: vi.fn((_items, callback) => {
      callback(result);
    }),
  };
}

beforeEach(() => {
  resetTelemetryHealth();
});

describe('instrumentExporter', () => {
  it('成功回调记录 attempts/lastSuccessAt，并转发原结果', () => {
    const exporter = createExporter({ code: 0 });
    const callback = vi.fn();
    instrumentExporter(exporter, 'traces').export([], callback);
    expect(callback).toHaveBeenCalledWith({ code: 0 });
    expect(getTelemetryHealth().traces).toMatchObject({ attempts: 1, failures: 0 });
  });

  it('失败回调记录 failures/lastError', () => {
    const error = new Error('connection refused');
    const exporter = createExporter({ code: 1, error });
    instrumentExporter(exporter, 'metrics').export([], vi.fn());
    expect(getTelemetryHealth().metrics).toMatchObject({ attempts: 1, failures: 1 });
    expect(getTelemetryHealth().metrics.lastError).toBe('connection refused');
  });

  it('坏错误 getter 不阻断 SDK 回调，回调抛错不重复统计导出', () => {
    const error = new Error('synthetic');
    Object.defineProperty(error, 'message', {
      get: () => {
        throw new Error('getter');
      },
    });
    const exporter = instrumentExporter(createExporter({ code: 1, error }), 'logs');
    const callback = vi.fn();
    expect(() => exporter.export([], callback)).not.toThrow();
    expect(callback).toHaveBeenCalledWith({ code: 1, error });
    expect(getTelemetryHealth().logs.lastError).toBe('export failed');
    const failure = new Error('callback');
    expect(() =>
      exporter.export([], () => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(getTelemetryHealth().logs.attempts).toBe(2);
  });

  it('坏 SDK 结果 getter 不阻断原回调，未知抛出值不做不安全转换', () => {
    const result = {
      code: 1,
      get error(): never {
        throw new Error('getter');
      },
    };
    const callback = vi.fn();
    expect(() =>
      instrumentExporter(createExporter(result), 'logs').export([], callback),
    ).not.toThrow();
    expect(callback).toHaveBeenCalledWith(result);
    const failure = {
      toString: (): never => {
        throw new Error('conversion');
      },
    };
    const exporter: FakeExporter = {
      export: () => {
        throw failure;
      },
    };
    let caught: unknown;
    try {
      instrumentExporter(exporter, 'logs').export([], callback);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });

  it('同步抛错记录失败并原样抛出', () => {
    const exporter: FakeExporter = {
      export: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    const wrapped = instrumentExporter(exporter, 'logs');
    expect(() => wrapped.export([], vi.fn())).toThrow('boom');
    expect(getTelemetryHealth().logs.failures).toBe(1);
  });
});
