import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { hardenSession } from './session-hardening';

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type RequestHandler = (
  webContents: { getURL(): string },
  permission: string,
  callback: (granted: boolean) => void,
) => void;

type CheckHandler = (webContents: { getURL(): string }, permission: string) => boolean;

function createFakeSession(): {
  session: Session;
  onHeadersReceived: ReturnType<typeof vi.fn>;
  requestHandler: () => RequestHandler;
  checkHandler: () => CheckHandler;
} {
  const onHeadersReceived = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const setPermissionCheckHandler = vi.fn();
  const session = {
    webRequest: { onHeadersReceived },
    setPermissionRequestHandler,
    setPermissionCheckHandler,
  } as unknown as Session;
  hardenSession(session, false);
  return {
    session,
    onHeadersReceived,
    requestHandler: () => setPermissionRequestHandler.mock.calls[0]?.[0] as RequestHandler,
    checkHandler: () => setPermissionCheckHandler.mock.calls[0]?.[0] as CheckHandler,
  };
}

describe('hardenSession', () => {
  it('同时安装 CSP 响应头注入与权限 handler', () => {
    const { onHeadersReceived, requestHandler, checkHandler } = createFakeSession();
    expect(onHeadersReceived).toHaveBeenCalledOnce();
    expect(requestHandler()).toBeTypeOf('function');
    expect(checkHandler()).toBeTypeOf('function');
  });

  it('只放行剪贴板写，其他权限请求拒绝', () => {
    const { requestHandler } = createFakeSession();
    const handler = requestHandler();
    const webContents = { getURL: () => 'file:///app/index.html' };
    const allow = vi.fn();
    const deny = vi.fn();

    handler(webContents, 'clipboard-sanitized-write', allow);
    handler(webContents, 'media', deny);

    expect(allow).toHaveBeenCalledWith(true);
    expect(deny).toHaveBeenCalledWith(false);
  });

  it('权限检查只对剪贴板写返回 true', () => {
    const { checkHandler } = createFakeSession();
    const handler = checkHandler();
    const webContents = { getURL: () => 'file:///app/index.html' };

    expect(handler(webContents, 'clipboard-sanitized-write')).toBe(true);
    expect(handler(webContents, 'clipboard-read')).toBe(false);
  });
});
