import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  const connect = vi.fn();
  const sessionSetProxy = vi.fn().mockResolvedValue(undefined);
  const resolveProxy = vi.fn();
  const fromPartition = vi.fn(() => ({
    setProxy: sessionSetProxy,
    resolveProxy,
  }));
  return {
    secrets,
    connect,
    sessionSetProxy,
    resolveProxy,
    fromPartition,
    applyProxyChange: vi.fn(),
    fetchViaProxy: vi.fn(),
    setProxyFetchConfig: vi.fn(),
    readSetting: vi.fn(),
    broadcastSettingChanged: vi.fn(),
    connectOutcome: 'connect' as 'connect' | 'error',
  };
});

vi.mock('electron', () => ({
  session: {
    fromPartition: mocks.fromPartition,
    defaultSession: {},
  },
}));

vi.mock('../infra/storage/keychain', () => ({
  setSecret: vi.fn(async (key: string, value: string) => {
    mocks.secrets.set(key, value);
  }),
  getSecret: vi.fn(async (key: string) => mocks.secrets.get(key) ?? null),
  deleteSecret: vi.fn(async (key: string) => {
    mocks.secrets.delete(key);
  }),
}));

vi.mock('../infra/network/proxy-applier', () => ({
  applyProxyChange: mocks.applyProxyChange,
}));

vi.mock('../infra/network/proxied-fetch', () => ({
  fetchViaProxy: mocks.fetchViaProxy,
  setProxyFetchConfig: mocks.setProxyFetchConfig,
}));

vi.mock('../infra/storage/settings-pref', () => ({
  readSetting: mocks.readSetting,
}));

vi.mock('../main-events', () => ({
  broadcastSettingChanged: mocks.broadcastSettingChanged,
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PROXY_AUTH_SECRET_KEY } from '../infra/network/proxy-credentials';
import { createProxyHandlers } from './proxy.handler';

const EMPTY_CTX = {} as never;
const handlers = createProxyHandlers({ connect: mocks.connect });

const FIXED = {
  mode: 'fixed' as const,
  protocol: 'http' as const,
  host: '127.0.0.1',
  port: 7890,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secrets.clear();
  mocks.connectOutcome = 'connect';
  mocks.readSetting.mockReturnValue({ mode: 'system' });
  mocks.fetchViaProxy.mockResolvedValue(new Response(null, { status: 204 }));
  mocks.connect.mockImplementation(() => {
    const socket = new EventEmitter() as EventEmitter & { destroy: () => void };
    socket.destroy = vi.fn();
    queueMicrotask(() => socket.emit(mocks.connectOutcome));
    return socket;
  });
  mocks.resolveProxy.mockResolvedValue('DIRECT');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('proxy:test', () => {
  it('非 fixed 模式不发起探测', async () => {
    await expect(handlers.test({}, EMPTY_CTX)).resolves.toMatchObject({
      ok: false,
      kind: 'not-applicable',
    });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.fetchViaProxy).not.toHaveBeenCalled();
  });

  it('fixed HTTP → TCP 预探 + 经代理 fetch，返回耗时', async () => {
    await expect(handlers.test({ config: FIXED }, EMPTY_CTX)).resolves.toMatchObject({
      ok: true,
      kind: 'ok',
    });
    expect(mocks.connect).toHaveBeenCalledWith({ host: '127.0.0.1', port: 7890 });
    expect(mocks.fetchViaProxy).toHaveBeenCalledWith(
      FIXED,
      'https://www.gstatic.com/generate_204',
      expect.objectContaining({ signal: expect.anything() }),
    );
    // 草稿测试不修改全局 Node 侧配置
    expect(mocks.setProxyFetchConfig).not.toHaveBeenCalled();
  });

  it('代理端口不可达 → proxy-unreachable，不再发请求', async () => {
    mocks.connectOutcome = 'error';
    await expect(handlers.test({ config: FIXED }, EMPTY_CTX)).resolves.toMatchObject({
      ok: false,
      kind: 'proxy-unreachable',
    });
    expect(mocks.fetchViaProxy).not.toHaveBeenCalled();
  });

  it('407 → auth-failed', async () => {
    mocks.fetchViaProxy.mockResolvedValue(new Response(null, { status: 407 }));
    await expect(handlers.test({ config: FIXED }, EMPTY_CTX)).resolves.toMatchObject({
      ok: false,
      kind: 'auth-failed',
    });
  });

  it('代理后目标失败 → target-unreachable；SOCKS5 握手失败 → proxy-unreachable', async () => {
    mocks.fetchViaProxy.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(handlers.test({ config: FIXED }, EMPTY_CTX)).resolves.toMatchObject({
      kind: 'target-unreachable',
    });
    mocks.fetchViaProxy.mockRejectedValueOnce(new Error('UND_ERR_SOCKS5'));
    await expect(handlers.test({ config: FIXED }, EMPTY_CTX)).resolves.toMatchObject({
      kind: 'proxy-unreachable',
    });
  });

  it('3s 未完成 → timeout', async () => {
    vi.useFakeTimers();
    mocks.fetchViaProxy.mockImplementation(
      (_cfg, _target, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit | undefined)?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const pending = handlers.test({ config: FIXED }, EMPTY_CTX);
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(pending).resolves.toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('草稿不带密码 → 同端点沿用 keychain 凭据', async () => {
    mocks.secrets.set(PROXY_AUTH_SECRET_KEY, 'http://alice:s3cret@127.0.0.1:7890');
    mocks.readSetting.mockReturnValue(FIXED);

    await handlers.test({ config: FIXED }, EMPTY_CTX);

    expect(mocks.fetchViaProxy).toHaveBeenCalledWith(
      { ...FIXED, auth: { username: 'alice', password: 's3cret' } },
      expect.any(String),
      expect.anything(),
    );
  });

  it('测试已保存配置时对齐全局 Node 侧配置', async () => {
    mocks.readSetting.mockReturnValue(FIXED);
    await handlers.test({}, EMPTY_CTX);
    expect(mocks.setProxyFetchConfig).toHaveBeenCalledWith(FIXED);
  });
});

describe('proxy:detectSystem', () => {
  it('解析 PROXY / SOCKS5，DIRECT 与 SOCKS4 返回未检测到', async () => {
    mocks.resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7890; DIRECT');
    await expect(handlers.detectSystem(undefined, EMPTY_CTX)).resolves.toEqual({
      detected: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });

    mocks.resolveProxy.mockResolvedValue('SOCKS5 127.0.0.1:1080');
    await expect(handlers.detectSystem(undefined, EMPTY_CTX)).resolves.toEqual({
      detected: true,
      protocol: 'socks5',
      host: '127.0.0.1',
      port: 1080,
    });

    mocks.resolveProxy.mockResolvedValue('DIRECT');
    await expect(handlers.detectSystem(undefined, EMPTY_CTX)).resolves.toEqual({
      detected: false,
    });

    mocks.resolveProxy.mockResolvedValue('SOCKS4 127.0.0.1:1080');
    await expect(handlers.detectSystem(undefined, EMPTY_CTX)).resolves.toEqual({
      detected: false,
    });
  });

  it('resolveProxy 抛错 → detected=false，不抛', async () => {
    mocks.resolveProxy.mockRejectedValue(new Error('boom'));
    await expect(handlers.detectSystem(undefined, EMPTY_CTX)).resolves.toEqual({
      detected: false,
    });
  });
});

describe('proxy:clearAuth', () => {
  it('清除 keychain、重应用并广播派生状态', async () => {
    mocks.secrets.set(PROXY_AUTH_SECRET_KEY, 'http://u:p@127.0.0.1:7890');
    mocks.readSetting.mockReturnValue(FIXED);

    await expect(handlers.clearAuth(undefined, EMPTY_CTX)).resolves.toEqual({ ok: true });
    expect(mocks.secrets.has(PROXY_AUTH_SECRET_KEY)).toBe(false);
    expect(mocks.applyProxyChange).toHaveBeenCalledWith(FIXED);
    expect(mocks.broadcastSettingChanged).toHaveBeenCalledWith(
      'proxy',
      expect.objectContaining({ hasAuth: false }),
    );
  });
});
