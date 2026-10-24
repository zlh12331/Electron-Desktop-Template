import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProxyRuntimeConfig: vi.fn(),
  clearProxyAuthCredentials: vi.fn(),
  applyProxySetting: vi.fn(),
  enrichProxySetting: vi.fn(),
  setProxyFetchConfig: vi.fn(),
  proxiedFetch: vi.fn(),
  readSetting: vi.fn(),
  broadcastSettingChanged: vi.fn(),
}));

vi.mock('../infra/network/proxy-credentials', () => ({
  resolveProxyRuntimeConfig: mocks.resolveProxyRuntimeConfig,
  clearProxyAuthCredentials: mocks.clearProxyAuthCredentials,
  applyProxySetting: mocks.applyProxySetting,
  enrichProxySetting: mocks.enrichProxySetting,
}));

vi.mock('../infra/network/proxied-fetch', () => ({
  setProxyFetchConfig: mocks.setProxyFetchConfig,
  proxiedFetch: mocks.proxiedFetch,
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

import { createProxyHandlers } from './proxy.handler';

const EMPTY_CTX = {} as never;
const handlers = createProxyHandlers();

describe('proxy.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSetting.mockReturnValue({ mode: 'fixed', url: 'http://p:8080' });
    mocks.resolveProxyRuntimeConfig.mockResolvedValue({ mode: 'fixed', url: 'http://p:8080' });
    mocks.proxiedFetch.mockResolvedValue(new Response(null, { status: 204 }));
    mocks.enrichProxySetting.mockResolvedValue({
      mode: 'fixed',
      url: 'http://p:8080',
      hasAuth: false,
    });
  });

  it('非 fixed 模式不发起探测', async () => {
    mocks.resolveProxyRuntimeConfig.mockResolvedValue({ mode: 'system' });
    await expect(handlers.test({}, EMPTY_CTX)).resolves.toMatchObject({
      ok: false,
      kind: 'not-applicable',
    });
    expect(mocks.proxiedFetch).not.toHaveBeenCalled();
  });

  it('fixed 模式注入配置并返回成功归因', async () => {
    await expect(handlers.test({}, EMPTY_CTX)).resolves.toMatchObject({ ok: true, kind: 'ok' });
    expect(mocks.setProxyFetchConfig).toHaveBeenCalledWith({ mode: 'fixed', url: 'http://p:8080' });
  });

  it('探测失败归因 target-unreachable 并保留真实错误文本', async () => {
    mocks.proxiedFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(handlers.test({}, EMPTY_CTX)).resolves.toMatchObject({
      ok: false,
      kind: 'target-unreachable',
      message: 'ECONNREFUSED',
    });
  });

  it('clearAuth 清除凭据、重应用并广播派生状态', async () => {
    await expect(handlers.clearAuth(undefined, EMPTY_CTX)).resolves.toEqual({ ok: true });
    expect(mocks.clearProxyAuthCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.applyProxySetting).toHaveBeenCalledWith({ mode: 'fixed', url: 'http://p:8080' });
    expect(mocks.broadcastSettingChanged).toHaveBeenCalledWith(
      'proxy',
      expect.objectContaining({ hasAuth: false }),
    );
  });
});
