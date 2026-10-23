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
