import { beforeEach, describe, expect, it } from 'vitest';

import {
  getTelemetryHealth,
  recordExportResult,
  recordLogDrop,
  recordSuppressedError,
  resetTelemetryHealth,
} from './telemetry-health';

beforeEach(() => {
  resetTelemetryHealth();
});

describe('telemetry-health', () => {
  it('初始快照全零', () => {
    expect(getTelemetryHealth()).toMatchObject({
      traces: { attempts: 0, failures: 0, lastSuccessAt: null, lastError: null },
      sampledLogs: 0,
      rateLimitedLogs: 0,
    });
  });

  it('记录成功/失败与脱敏后的错误', () => {
    recordExportResult('traces', true);
    const error = new Error('token=sk-aaaaaaaa');
    recordExportResult('logs', false, error);
    const health = getTelemetryHealth();
    expect(health.traces.attempts).toBe(1);
    expect(health.traces.lastSuccessAt).not.toBeNull();
    expect(health.logs.failures).toBe(1);
    expect(health.logs.lastError).toBe('token=[REDACTED]');
    expect(health.logs.lastFailureAt).not.toBeNull();
  });

  it('记录采样/限流丢弃计数', () => {
    recordLogDrop('sampled');
    recordLogDrop('rate-limited');
    recordLogDrop('rate-limited');
    const health = getTelemetryHealth();
    expect(health.sampledLogs).toBe(1);
    expect(health.rateLimitedLogs).toBe(2);
    expect(health.lastDropAt).not.toBeNull();
  });

  it('suppressedErrors 累加并随健康重置清空', () => {
    recordSuppressedError();
    recordSuppressedError();
    expect(getTelemetryHealth().suppressedErrors).toBe(2);
    resetTelemetryHealth();
    expect(getTelemetryHealth().suppressedErrors).toBe(0);
  });

  it('错误 getter 或转换失败不反噬结果记录，普通密码脱敏', () => {
    const error = new Error('synthetic');
    Object.defineProperty(error, 'message', {
      get: () => {
        throw new Error('getter');
      },
    });
    expect(() => recordExportResult('logs', false, error)).not.toThrow();
    expect(getTelemetryHealth().logs.lastError).toBe('export failed');
    recordExportResult('logs', false, new Error('password=abc'));
    expect(getTelemetryHealth().logs.lastError).toBe('password=[REDACTED]');
  });

  it('快照是副本，外部修改不影响内部状态', () => {
    const snapshot = getTelemetryHealth();
    (snapshot.traces as { attempts: number }).attempts = 99;
    expect(getTelemetryHealth().traces.attempts).toBe(0);
  });
});
