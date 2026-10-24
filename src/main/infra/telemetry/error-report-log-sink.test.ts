import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  log: {
    transports: { file: {}, console: {} },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({ default: mocks.log }));
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { reportError, reportMessage, setErrorCaptureSink } from '../../utils/error-report';
import { setLogSink } from '../../utils/logger';
import { clearOtelLogSink, emitOtelLog, setOtelLogSink } from './otel-log';

afterEach(() => {
  setErrorCaptureSink(null);
  setLogSink(null);
  clearOtelLogSink();
  vi.clearAllMocks();
});

describe('error-report 实 logger 出口', () => {
  it('未注册 sink：本地日志照写，不抛错', () => {
    expect(() => reportError(new Error('boom'))).not.toThrow();
    expect(() => reportMessage('warning', 'warning')).not.toThrow();
    expect(mocks.log.error).toHaveBeenCalled();
    expect(mocks.log.warn).toHaveBeenCalled();
  });

  it('注册 sink：异常/消息同时进后端捕获', () => {
    const sink = { captureError: vi.fn(), captureMessage: vi.fn() };
    setErrorCaptureSink(sink);
    const error = new Error('boom');
    const context = { tags: { boundary: 'test' } };
    reportError(error, context);
    reportMessage('disk full', 'error');
    reportMessage('memory growth', 'warning');
    expect(sink.captureError).toHaveBeenCalledWith(error, context);
    expect(sink.captureMessage).toHaveBeenCalledWith('disk full', 'error');
    expect(sink.captureMessage).toHaveBeenCalledWith('memory growth', 'warning');
  });

  it('本地 fields/message 不经过 LogSink 绕过远端边界，异常原文仍上行脱敏', () => {
    const capture = { captureError: vi.fn(), captureMessage: vi.fn() };
    const emit = vi.fn();
    setErrorCaptureSink(capture);
    setOtelLogSink({ emit } as unknown as OtelLogger, {
      minLevel: 'info',
      sampleRatio: 1,
      maxPerMinute: 0,
    });
    setLogSink(emitOtelLog);
    const error = new Error('password=abc');
    error.stack = 'Error: password=abc';
    reportError(error, {
      message: '数据库备份失败 /synthetic/local-only.db',
      fields: {
        dbPath: '/synthetic/local-only.db',
        password: 'local-fixture',
        detail: { nested: 'local-only' },
      },
      tags: { scope: 'db', stage: 'backup' },
      componentStack: 'at Component',
    });
    expect(mocks.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        dbPath: '/synthetic/local-only.db',
        password: 'local-fixture',
        message: '数据库备份失败 /synthetic/local-only.db',
        error: expect.objectContaining({ message: 'password=abc' }),
      }),
    );
    expect(capture.captureError).toHaveBeenCalledWith(error, {
      tags: { scope: 'db', stage: 'backup' },
      componentStack: 'at Component',
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '错误上报',
        attributes: expect.objectContaining({
          'log.scope': 'db',
          'log.stage': 'backup',
          'error.component_stack': 'at Component',
          'exception.message': 'password=[REDACTED]',
        }),
      }),
    );
    const exported = JSON.stringify(emit.mock.calls);
    expect(exported).not.toContain('local-only');
    expect(exported).not.toContain('local-fixture');
    expect(exported).not.toContain('password=abc');
  });

  it('两个 sink 均失败时，本地记录仍完整且不二次抛错', () => {
    const fail = (): never => {
      throw new Error('synthetic sdk failure');
    };
    setErrorCaptureSink({ captureError: fail, captureMessage: fail });
    setLogSink(fail);
    expect(() => reportError(new Error('boom'))).not.toThrow();
    expect(() => reportMessage('boom')).not.toThrow();
    expect(mocks.log.error).toHaveBeenCalledTimes(2);
  });
});
