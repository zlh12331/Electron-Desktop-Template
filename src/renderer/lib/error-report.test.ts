import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
}));

vi.mock('electron-log/renderer', () => ({
  default: { error: mocks.logError },
}));

import { initRendererErrorHandlers, reportError } from './error-report';

function captureSpy(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({ data: { accepted: true } }));
  (window.api.telemetry as unknown as { captureError: unknown }).captureError = spy;
  return spy;
}

beforeEach(() => {
  mocks.logError.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportError', () => {
  it('Error：本地 electron-log + 主进程 IPC 双通道，字段归一', async () => {
    const spy = captureSpy();
    const error = new Error('boom');
    error.stack = 'Error: boom\n at app.tsx:1:1';

    reportError(error, {
      tags: { boundary: 'AppErrorBoundary' },
      componentStack: 'at App',
    });

    expect(spy).toHaveBeenCalledWith({
      name: 'Error',
      message: 'boom',
      stack: 'Error: boom\n at app.tsx:1:1',
      componentStack: 'at App',
      tags: { boundary: 'AppErrorBoundary' },
    });
    await vi.waitFor(() => {
      expect(mocks.logError).toHaveBeenCalledWith(
        expect.objectContaining({ boundary: 'AppErrorBoundary', message: '渲染层错误上报' }),
        'Error: boom\n at app.tsx:1:1',
      );
    });
  });

  it('非 Error：转成 NonErrorThrow + 字符串消息', async () => {
    const spy = captureSpy();
    reportError('plain failure');
    expect(spy).toHaveBeenCalledWith({
      name: 'NonErrorThrow',
      message: 'plain failure',
    });
  });

  it('超长字段按 IPC schema 上限截断（避免整条被 INVALID_INPUT 拒绝）', () => {
    const spy = captureSpy();
    const tags: Record<string, string> = {};
    for (let i = 0; i < 25; i += 1) {
      tags[`k${i}`] = 'v'.repeat(300);
    }
    reportError(new Error('m'.repeat(9_000)), {
      componentStack: 'c'.repeat(20_000),
      tags,
    });
    const payload = spy.mock.calls[0]?.[0] as {
      message: string;
      componentStack: string;
      tags: Record<string, string>;
    };
    expect(payload.message.length).toBeLessThanOrEqual(8_193);
    expect(payload.componentStack.length).toBeLessThanOrEqual(16_385);
    expect(Object.keys(payload.tags)).toHaveLength(20);
    expect(Object.values(payload.tags)[0]?.length).toBeLessThanOrEqual(257);
  });

  it('无 IPC 桥：只落本地日志，不转发', () => {
    const spy = captureSpy();
    (window as unknown as { api: undefined }).api = undefined;
    expect(() => reportError(new Error('offline'))).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('旧 preload 缺少 captureError：静默跳过', () => {
    (window.api as unknown as { telemetry: undefined }).telemetry = undefined;
    expect(() => reportError(new Error('x'))).not.toThrow();
  });
});

describe('initRendererErrorHandlers', () => {
  it('window.error：上报 error 对象并带 scope', () => {
    const spy = captureSpy();
    initRendererErrorHandlers();
    const error = new Error('window boom');
    window.dispatchEvent(new ErrorEvent('error', { error }));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'window boom', tags: { scope: 'window.onerror' } }),
    );
  });

  it('unhandledrejection：AbortError 静默，其他 reason 上报', () => {
    const spy = captureSpy();
    initRendererErrorHandlers();

    const abortEvent = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new DOMException('aborted', 'AbortError'),
    });
    window.dispatchEvent(abortEvent);
    expect(spy).not.toHaveBeenCalled();

    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error('rejected'),
      }),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'rejected', tags: { scope: 'unhandledrejection' } }),
    );
  });
});
