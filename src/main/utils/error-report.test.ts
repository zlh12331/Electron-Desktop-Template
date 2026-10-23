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
});
