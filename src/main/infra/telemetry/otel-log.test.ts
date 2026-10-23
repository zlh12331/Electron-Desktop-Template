import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOtelLogSink, emitOtelLog, isOtelLogsEnabled, setOtelLogSink } from './otel-log';
import { getTelemetryHealth, resetTelemetryHealth } from './telemetry-health';

function createSink(): { logger: OtelLogger; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return {
    emit,
    logger: { emit, enabled: () => true } as unknown as OtelLogger,
  };
}

beforeEach(() => {
  resetTelemetryHealth();
});

afterEach(() => {
  clearOtelLogSink();
  vi.restoreAllMocks();
});

describe('emitOtelLog', () => {
  it('sink 未绑定：完全 no-op', () => {
    expect(isOtelLogsEnabled()).toBe(false);
    expect(() => emitOtelLog('error', {}, 'boom')).not.toThrow();
  });

  it('info 级别：severity + 正文 + 上下文键映射', () => {
    const sink = createSink();
    setOtelLogSink(sink.logger, { minLevel: 'info', sampleRatio: 1, maxPerMinute: 0 });
    emitOtelLog(
      'info',
      { traceId: 'trace-1', channel: 'app:getInfo', scope: 'auto-updater', custom: 42 },
      'IPC 请求成功',
    );

    expect(sink.emit).toHaveBeenCalledWith({
      severityNumber: SeverityNumber.INFO,
      severityText: 'INFO',
      body: 'IPC 请求成功',
      attributes: {
        'app.trace_id': 'trace-1',
        'ipc.channel': 'app:getInfo',
        'log.scope': 'auto-updater',
        'log.custom': 42,
      },
    });
  });

  it('error-only 级别过滤：info/warn 丢弃，error 放行', () => {
    const sink = createSink();
    setOtelLogSink(sink.logger, { minLevel: 'error', sampleRatio: 1, maxPerMinute: 0 });
    emitOtelLog('info', {}, 'info');
    emitOtelLog('warn', {}, 'warn');
    emitOtelLog('error', {}, 'error');
    expect(sink.emit).toHaveBeenCalledTimes(1);
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ severityText: 'ERROR' }));
  });

  it('采样率 0：info 丢弃、error 保留，并记录 sampledLogs', () => {
    const sink = createSink();
    setOtelLogSink(sink.logger, { minLevel: 'info', sampleRatio: 0, maxPerMinute: 0 });
    emitOtelLog('info', {}, 'sampled out');
    emitOtelLog('error', {}, 'kept');
    expect(sink.emit).toHaveBeenCalledTimes(1);
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ severityText: 'ERROR' }));
    expect(getTelemetryHealth().sampledLogs).toBe(1);
  });

  it('每分钟上限：info 超出丢弃、error 永远放行', () => {
    const sink = createSink();
    setOtelLogSink(sink.logger, { minLevel: 'info', sampleRatio: 1, maxPerMinute: 1 });
    emitOtelLog('info', {}, 'first');
    emitOtelLog('info', {}, 'second');
    emitOtelLog('error', {}, 'error');
    expect(sink.emit).toHaveBeenCalledTimes(2);
    expect(getTelemetryHealth().rateLimitedLogs).toBe(1);
  });

  it('异常对象：提取 exception.*，正文与栈脱敏', () => {
    const sink = createSink();
    setOtelLogSink(sink.logger, { minLevel: 'info', sampleRatio: 1, maxPerMinute: 0 });
    const error = new Error('token=sk-aaaaaaaa');
    error.stack = 'Error: sk-aaaaaaaa\n    at file.ts:1:1';
    emitOtelLog('error', {}, '操作失败', error);

    const record = sink.emit.mock.calls[0]?.[0] as {
      attributes: Record<string, unknown>;
    };
    expect(record.attributes['exception.type']).toBe('Error');
    expect(record.attributes['exception.message']).toBe('token=sk-[REDACTED]');
    expect(record.attributes['exception.stacktrace']).toContain('sk-[REDACTED]');
  });

  it('序列化后的 error 字段同样可提取', () => {
    const sink = createSink();
    setOtelLogSink(sink.logger, { minLevel: 'info', sampleRatio: 1, maxPerMinute: 0 });
    emitOtelLog('error', { error: { name: 'TypeError', message: 'bad', stack: 'at x' } }, '失败');
    const record = sink.emit.mock.calls[0]?.[0] as {
      attributes: Record<string, unknown>;
    };
    expect(record.attributes['exception.type']).toBe('TypeError');
    expect(record.attributes['exception.message']).toBe('bad');
    expect(record.attributes['exception.stacktrace']).toBe('at x');
  });

  it('不可序列化上下文被跳过，不让日志路径抛错', () => {
    const sink = createSink();
    setOtelLogSink(sink.logger, { minLevel: 'info', sampleRatio: 1, maxPerMinute: 0 });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => emitOtelLog('info', { circular }, 'ok')).not.toThrow();
    const record = sink.emit.mock.calls[0]?.[0] as { attributes: Record<string, unknown> };
    expect(record.attributes['log.circular']).toBeUndefined();
  });

  it('导出器抛错被吞掉（遥测不能反噬日志）', () => {
    const logger = {
      emit: vi.fn(() => {
        throw new Error('export failed');
      }),
      enabled: () => true,
    } as unknown as OtelLogger;
    setOtelLogSink(logger, { minLevel: 'info', sampleRatio: 1, maxPerMinute: 0 });
    expect(() => emitOtelLog('info', {}, 'ok')).not.toThrow();
  });
});
