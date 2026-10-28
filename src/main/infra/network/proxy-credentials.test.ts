import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  applyProxyChange: vi.fn(),
  failGet: false,
  failSet: false,
}));

vi.mock('../storage/keychain', () => ({
  setSecret: vi.fn(async (key: string, value: string) => {
    if (mocks.failSet) {
      throw new Error('keychain unavailable');
    }
    mocks.secrets.set(key, value);
  }),
  getSecret: vi.fn(async (key: string) => {
    if (mocks.failGet) {
      throw new Error('keychain unavailable');
    }
    return mocks.secrets.get(key) ?? null;
  }),
  deleteSecret: vi.fn(async (key: string) => {
    mocks.secrets.delete(key);
  }),
}));

vi.mock('./proxy-applier', () => ({
  applyProxyChange: mocks.applyProxyChange,
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  applyProxySetting,
  clearProxyAuthCredentials,
  enrichProxySetting,
  getProxyAuthStatus,
  migrateProxyCredentials,
  PROXY_AUTH_SECRET_KEY,
  resolveProxyRuntimeConfig,
  sameProxyEndpoint,
  sanitizeProxySetting,
} from './proxy-credentials';

const FIXED = {
  mode: 'fixed' as const,
  protocol: 'http' as const,
  host: 'proxy.example',
  port: 8080,
};

describe('sameProxyEndpoint', () => {
  it('同协议/主机/端口视为同端点，路径不影响', () => {
    expect(sameProxyEndpoint('http://p:8080', 'http://p:8080/path')).toBe(true);
    expect(sameProxyEndpoint('http://p:8080', 'http://q:8080')).toBe(false);
    expect(sameProxyEndpoint('http://p:8080', 'https://p:8080')).toBe(false);
  });

  it('非法 URL → false（不抛）', () => {
    expect(sameProxyEndpoint('not-a-url', 'http://p:8080')).toBe(false);
  });
});

describe('代理凭据生命周期', () => {
  beforeEach(() => {
    mocks.secrets.clear();
    mocks.failGet = false;
    mocks.failSet = false;
    vi.clearAllMocks();
  });

  it('结构化认证：凭据进 keychain，落库值只留协议/主机/端口/bypass', async () => {
    const sanitized = await sanitizeProxySetting({
      ...FIXED,
      bypass: ['corp.example'],
      auth: { username: 'alice', password: 's3cret' },
    });

    expect(sanitized).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: 'proxy.example',
      port: 8080,
      bypass: ['corp.example'],
    });
    expect(mocks.secrets.get(PROXY_AUTH_SECRET_KEY)).toBe('http://alice:s3cret@proxy.example:8080');
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: true, username: 'alice' });
    await expect(enrichProxySetting(sanitized)).resolves.toMatchObject({
      hasAuth: true,
      authUsername: 'alice',
    });
  });

  it('旧版 URL 形态：迁移为结构化 + keychain', async () => {
    const sanitized = await sanitizeProxySetting({
      mode: 'fixed',
      url: 'http://alice:s3cret@proxy.example:8080',
      bypass: ['corp.example'],
    });

    expect(sanitized).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: 'proxy.example',
      port: 8080,
      bypass: ['corp.example'],
    });
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: true, username: 'alice' });
  });

  it('同端点编辑保留凭据；换端点或切模式清除', async () => {
    await sanitizeProxySetting({ ...FIXED, auth: { username: 'alice', password: 's3cret' } });

    await sanitizeProxySetting({ ...FIXED, host: 'proxy.example' });
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: true, username: 'alice' });

    await sanitizeProxySetting({ ...FIXED, host: 'other.example' });
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: false, username: null });

    await sanitizeProxySetting({ ...FIXED, auth: { username: 'alice', password: 's3cret' } });
    await sanitizeProxySetting({ mode: 'system' });
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: false, username: null });
  });

  it('运行时配置注入凭据，applyProxySetting 交给代理应用层', async () => {
    await sanitizeProxySetting({ ...FIXED, auth: { username: 'alice', password: 's3cret' } });

    await expect(resolveProxyRuntimeConfig(FIXED)).resolves.toEqual({
      ...FIXED,
      auth: { username: 'alice', password: 's3cret' },
    });

    await applyProxySetting(FIXED);
    expect(mocks.applyProxyChange).toHaveBeenCalledWith({
      ...FIXED,
      auth: { username: 'alice', password: 's3cret' },
    });
  });

  it('清除凭据后运行时不再注入', async () => {
    await sanitizeProxySetting({ ...FIXED, auth: { username: 'alice', password: 's3cret' } });
    await clearProxyAuthCredentials();
    await expect(resolveProxyRuntimeConfig(FIXED)).resolves.toEqual(FIXED);
  });

  it('SOCKS5 认证被丢弃（Chromium 限制），不写 keychain', async () => {
    const sanitized = await sanitizeProxySetting({
      mode: 'fixed',
      protocol: 'socks5',
      host: '127.0.0.1',
      port: 1080,
      auth: { username: 'u', password: 'p' },
    });
    expect(sanitized).toEqual({
      mode: 'fixed',
      protocol: 'socks5',
      host: '127.0.0.1',
      port: 1080,
    });
    expect(mocks.secrets.has(PROXY_AUTH_SECRET_KEY)).toBe(false);
  });

  it('keychain 读取失败 → 按未配置处理', async () => {
    mocks.failGet = true;
    await expect(getProxyAuthStatus()).resolves.toEqual({ hasAuth: false, username: null });
  });

  it('keychain 中的损坏值 / 非法协议 / 无凭据 → 按未配置处理', async () => {
    for (const raw of ['not a url', 'ftp://u:p@host', 'http://host:8080']) {
      mocks.secrets.set(PROXY_AUTH_SECRET_KEY, raw);
      await expect(getProxyAuthStatus()).resolves.toEqual({ hasAuth: false, username: null });
    }
  });

  it('keychain 写入失败 → 抛可读错误（不回退明文）', async () => {
    mocks.failSet = true;
    await expect(
      sanitizeProxySetting({ ...FIXED, auth: { username: 'u', password: 'p' } }),
    ).rejects.toThrow('系统加密不可用');
  });

  it('enrich 非对象值原样返回', async () => {
    await expect(enrichProxySetting('garbage')).resolves.toBe('garbage');
  });

  it('运行时端点不一致 → 不注入旧凭据', async () => {
    await sanitizeProxySetting({ ...FIXED, auth: { username: 'alice', password: 's3cret' } });
    await expect(resolveProxyRuntimeConfig({ ...FIXED, host: 'other.example' })).resolves.toEqual({
      ...FIXED,
      host: 'other.example',
    });
  });

  it('migrateProxyCredentials 复用旧 URL 迁移', async () => {
    await expect(
      migrateProxyCredentials({ mode: 'fixed', url: 'http://u:p@proxy.example:8080' }),
    ).resolves.toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: 'proxy.example',
      port: 8080,
    });
  });
});
