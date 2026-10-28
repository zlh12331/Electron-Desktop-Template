import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  proxyAgentCtor: vi.fn(),
  sessionFetch: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('undici', () => {
  class FakeProxyAgent {
    close = mocks.close;
    constructor(uri: string) {
      mocks.proxyAgentCtor(uri);
    }
  }
  return { fetch: mocks.undiciFetch, ['ProxyAgent']: FakeProxyAgent };
});

vi.mock('electron', () => ({
  session: {
    defaultSession: { fetch: mocks.sessionFetch },
  },
}));

import {
  clearProxyAgents,
  fetchViaProxy,
  proxiedFetch,
  setProxyFetchConfig,
} from './proxied-fetch';

beforeEach(() => {
  clearProxyAgents();
  setProxyFetchConfig(null);
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
});

describe('proxiedFetch', () => {
  it('V1 未初始化 → Chromium session.fetch（system 默认）', async () => {
    mocks.sessionFetch.mockResolvedValue(new Response('ok'));
    await proxiedFetch('http://api.example.com/v1');
    expect(mocks.sessionFetch).toHaveBeenCalledTimes(1);
    expect(mocks.undiciFetch).not.toHaveBeenCalled();
  });

  it('fixed HTTP → undici + ProxyAgent dispatcher（V2）', async () => {
    setProxyFetchConfig({
      mode: 'fixed',
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
    mocks.undiciFetch.mockResolvedValue(new Response('ok'));

    await proxiedFetch('https://api.openai.com/v1/chat');

    expect(mocks.undiciFetch).toHaveBeenCalledTimes(1);
    expect(mocks.undiciFetch.mock.calls[0]?.[1]).toMatchObject({ dispatcher: expect.anything() });
    expect(mocks.proxyAgentCtor).toHaveBeenCalledWith('http://127.0.0.1:7890');
  });

  it('fixed SOCKS5 → undici（undici 8.x 原生支持）', async () => {
    setProxyFetchConfig({
      mode: 'fixed',
      protocol: 'socks5',
      host: '127.0.0.1',
      port: 1080,
    });
    mocks.undiciFetch.mockResolvedValue(new Response('ok'));

    await proxiedFetch('https://api.openai.com/v1/chat');

    expect(mocks.proxyAgentCtor).toHaveBeenCalledWith('socks5://127.0.0.1:1080');
  });

  it('V4 localhost / 用户 bypass → Chromium session.fetch（由 bypass 规则直连）', async () => {
    setProxyFetchConfig({
      mode: 'fixed',
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      bypass: ['corp.example'],
    });
    mocks.sessionFetch.mockResolvedValue(new Response('ok'));

    await proxiedFetch('http://127.0.0.1:9374/health');
    await proxiedFetch('https://api.corp.example/v1');

    expect(mocks.sessionFetch).toHaveBeenCalledTimes(2);
    expect(mocks.undiciFetch).not.toHaveBeenCalled();
  });

  it('V3 direct / system → Chromium session.fetch', async () => {
    mocks.sessionFetch.mockResolvedValue(new Response('ok'));
    setProxyFetchConfig({ mode: 'direct' });
    await proxiedFetch('https://api.openai.com/v1');
    setProxyFetchConfig({ mode: 'system' });
    await proxiedFetch('https://api.openai.com/v1');
    expect(mocks.sessionFetch).toHaveBeenCalledTimes(2);
    expect(mocks.undiciFetch).not.toHaveBeenCalled();
  });

  it('同 URL 复用 ProxyAgent（连接池），配置变更后缓存清空重建', async () => {
    setProxyFetchConfig({ mode: 'fixed', protocol: 'http', host: 'p1', port: 1 });
    mocks.undiciFetch.mockResolvedValue(new Response('ok'));
    await proxiedFetch('https://a.example.com');
    await proxiedFetch('https://b.example.com');
    expect(mocks.proxyAgentCtor).toHaveBeenCalledTimes(1);

    setProxyFetchConfig({ mode: 'fixed', protocol: 'http', host: 'p2', port: 2 });
    await proxiedFetch('https://a.example.com');
    expect(mocks.proxyAgentCtor).toHaveBeenCalledTimes(2);
    expect(mocks.proxyAgentCtor).toHaveBeenNthCalledWith(2, 'http://p2:2');
  });
});

describe('fetchViaProxy（一次性探测）', () => {
  it('成功/失败都关闭临时 agent', async () => {
    mocks.undiciFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await fetchViaProxy(
      { mode: 'fixed', protocol: 'http', host: 'p', port: 8080 },
      'https://example.com',
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);

    mocks.undiciFetch.mockRejectedValue(new Error('boom'));
    await expect(
      fetchViaProxy(
        { mode: 'fixed', protocol: 'http', host: 'p', port: 8080 },
        'https://example.com',
      ),
    ).rejects.toThrow('boom');
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });

  it('配置不完整 → 抛错', async () => {
    await expect(fetchViaProxy({ mode: 'system' }, 'https://example.com')).rejects.toThrow(
      '代理配置不完整',
    );
  });
});

describe('setProxyFetchConfig', () => {
  it('配置变更关闭旧 agent', async () => {
    setProxyFetchConfig({ mode: 'fixed', protocol: 'http', host: 'p', port: 1 });
    mocks.undiciFetch.mockResolvedValue(new Response('ok'));
    await proxiedFetch('https://a.example.com');
    expect(mocks.close).not.toHaveBeenCalled();

    setProxyFetchConfig({ mode: 'system' });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
