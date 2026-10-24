import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./logger', () => ({ logger: mocks.logger }));

import { reportError, reportMessage, setErrorCaptureSink } from './error-report';

afterEach(() => {
  setErrorCaptureSink(null);
  vi.clearAllMocks();
});

describe('error-report', () => {
  it('未注册 sink：本地日志照写，不抛错', () => {
    expect(() => reportError(new Error('boom'))).not.toThrow();
    expect(() => reportMessage('warning', 'warning')).not.toThrow();
    expect(mocks.logger.error).toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it('注册 sink：异常/消息同时进后端捕获', () => {
    const sink = {
      captureError: vi.fn(),
      captureMessage: vi.fn(),
    };
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

  it('自定义 message/fields：本地日志保留排障细节，后端只收 tags/componentStack', () => {
    const sink = { captureError: vi.fn(), captureMessage: vi.fn() };
    setErrorCaptureSink(sink);
    const error = new Error('disk io failed');
    reportError(error, {
      message: '数据库备份失败',
      fields: { dbPath: '/tmp/app.db' },
      tags: { scope: 'db', stage: 'backup' },
      componentStack: '\n at Component',
    });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      { dbPath: '/tmp/app.db', scope: 'db', stage: 'backup', componentStack: '\n at Component' },
      '数据库备份失败',
      error,
    );
    expect(sink.captureError).toHaveBeenCalledWith(error, {
      tags: { scope: 'db', stage: 'backup' },
      componentStack: '\n at Component',
    });
  });
});
