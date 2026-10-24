import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  applyProxyChange: vi.fn(),
}));

vi.mock('../storage/keychain', () => ({
  setSecret: vi.fn(async (key: string, value: string) => {
    mocks.secrets.set(key, value);
  }),
  getSecret: vi.fn(async (key: string) => mocks.secrets.get(key) ?? null),
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
  extractProxyCredentials,
  getProxyAuthStatus,
  PROXY_AUTH_SECRET_KEY,
  resolveProxyRuntimeConfig,
  sameProxyEndpoint,
  sanitizeProxySetting,
} from './proxy-credentials';

const CREDENTIAL_URL = 'http://alice:s3cret@proxy.example:8080';

describe('extractProxyCredentials', () => {
  it('拆出 userinfo 并解码用户名', () => {
    expect(extractProxyCredentials(CREDENTIAL_URL)).toEqual({
      sanitizedUrl: 'http://proxy.example:8080',
      authUrl: CREDENTIAL_URL,
      username: 'alice',
    });
  });

  it('无凭据/非法 URL 返回 null', () => {
    expect(extractProxyCredentials('http://proxy.example:8080')).toBeNull();
    expect(extractProxyCredentials('not a url')).toBeNull();
  });
});

describe('sameProxyEndpoint', () => {
  it('同协议/主机/端口视为同端点，路径不影响', () => {
    expect(sameProxyEndpoint('http://p:8080', 'http://p:8080/path')).toBe(true);
    expect(sameProxyEndpoint('http://p:8080', 'http://q:8080')).toBe(false);
    expect(sameProxyEndpoint('http://p:8080', 'https://p:8080')).toBe(false);
  });
});

describe('代理凭据生命周期', () => {
  beforeEach(() => {
    mocks.secrets.clear();
    vi.clearAllMocks();
  });

  it('带凭据 URL：凭据进 keychain，设置值只剩无凭据 URL', async () => {
    const sanitized = await sanitizeProxySetting({
      mode: 'fixed',
      url: CREDENTIAL_URL,
      bypass: ['corp.example'],
    });

    expect(sanitized).toEqual({
      mode: 'fixed',
      url: 'http://proxy.example:8080',
      bypass: ['corp.example'],
    });
    expect(mocks.secrets.get(PROXY_AUTH_SECRET_KEY)).toBe(CREDENTIAL_URL);
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: true, username: 'alice' });
    await expect(enrichProxySetting(sanitized)).resolves.toMatchObject({
      hasAuth: true,
      authUsername: 'alice',
    });
  });

  it('同端点编辑保留凭据；换端点或切模式清除', async () => {
    await sanitizeProxySetting({ mode: 'fixed', url: CREDENTIAL_URL });

    await sanitizeProxySetting({ mode: 'fixed', url: 'http://proxy.example:8080/edited' });
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: true, username: 'alice' });

    await sanitizeProxySetting({ mode: 'fixed', url: 'http://other.example:8080' });
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: false, username: null });

    await sanitizeProxySetting({ mode: 'fixed', url: CREDENTIAL_URL });
    await sanitizeProxySetting({ mode: 'system' });
    expect(await getProxyAuthStatus()).toEqual({ hasAuth: false, username: null });
  });

  it('运行时配置注入凭据，applyProxySetting 交给代理应用层', async () => {
    await sanitizeProxySetting({ mode: 'fixed', url: CREDENTIAL_URL });

    await expect(
      resolveProxyRuntimeConfig({ mode: 'fixed', url: 'http://proxy.example:8080' }),
    ).resolves.toEqual({ mode: 'fixed', url: CREDENTIAL_URL });

    await applyProxySetting({ mode: 'fixed', url: 'http://proxy.example:8080' });
    expect(mocks.applyProxyChange).toHaveBeenCalledWith({ mode: 'fixed', url: CREDENTIAL_URL });
  });

  it('清除凭据后运行时不再注入', async () => {
    await sanitizeProxySetting({ mode: 'fixed', url: CREDENTIAL_URL });
    await clearProxyAuthCredentials();
    await expect(
      resolveProxyRuntimeConfig({ mode: 'fixed', url: 'http://proxy.example:8080' }),
    ).resolves.toEqual({ mode: 'fixed', url: 'http://proxy.example:8080' });
  });
});
