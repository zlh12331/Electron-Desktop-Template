import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const setProxy = vi.fn().mockResolvedValue(undefined);
  const makeSession = () => ({ setProxy });
  return {
    setProxy,
    makeSession,
    defaultSession: makeSession(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: { on: mocks.on, removeListener: mocks.removeListener },
  session: {
    defaultSession: mocks.defaultSession,
    fromPartition: vi.fn(() => mocks.makeSession()),
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { applyProxyChange, resetProxyApplierForTests } from './proxy-applier';

const ENV_KEYS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
] as const;

beforeEach(() => {
  resetProxyApplierForTests();
  vi.clearAllMocks();
  mocks.setProxy.mockResolvedValue(undefined);
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

type LoginListener = (
  event: { preventDefault: () => void },
  webContents: unknown,
  details: unknown,
  authInfo: { isProxy: boolean; host: string; port: number },
  callback: (username?: string, password?: string) => void,
) => void;

function getLoginListener(): LoginListener {
  const call = mocks.on.mock.calls.find((entry) => entry[0] === 'login');
  if (call === undefined) {
    throw new Error('login listener 未注册');
  }
  return call[1] as LoginListener;
}

describe('applyProxyChange（四路径统一收口）', () => {
  it('V3 resetAll 语义（raw=undefined）→ 两分区回落 system + env 清空 + 缓存重置', async () => {
    await applyProxyChange(undefined);

    expect(mocks.setProxy).toHaveBeenCalledTimes(2);
    for (const call of mocks.setProxy.mock.calls) {
      expect(call[0]).toEqual({ mode: 'system' });
    }
    expect(process.env['HTTPS_PROXY']).toBeUndefined();
    expect(process.env['http_proxy']).toBeUndefined();
  });

  it('V2 fixed → 两分区 fixed_servers + proxyRules + <local> 前置', async () => {
    await applyProxyChange({ mode: 'fixed', url: 'http://127.0.0.1:7890', bypass: ['corp'] });

    expect(mocks.setProxy).toHaveBeenCalledTimes(2);
    expect(mocks.setProxy.mock.calls[0]?.[0]).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:7890;https=127.0.0.1:7890',
      proxyBypassRules: '<local>;corp',
    });
    expect(process.env['HTTPS_PROXY']).toBe('http://127.0.0.1:7890');
    expect(process.env['https_proxy']).toBe('http://127.0.0.1:7890');
    expect(process.env['NO_PROXY']).toBe('localhost,127.0.0.1,::1');
  });

  it('V1 system → 两分区 {mode: system}，保留启动时继承的代理 env', async () => {
    process.env['HTTP_PROXY'] = 'http://corp-proxy:3128';
    process.env['no_proxy'] = 'internal.example';
    await applyProxyChange({ mode: 'system' });

    expect(mocks.setProxy).toHaveBeenCalledTimes(2);
    expect(process.env['HTTP_PROXY']).toBe('http://corp-proxy:3128');
    expect(process.env['no_proxy']).toBe('internal.example');
  });

  it('fixed → system：恢复启动时继承的代理 env', async () => {
    process.env['HTTP_PROXY'] = 'http://corp-proxy:3128';
    process.env['no_proxy'] = 'internal.example';
    await applyProxyChange({ mode: 'fixed', url: 'http://127.0.0.1:7890' });
    expect(process.env['HTTP_PROXY']).toBe('http://127.0.0.1:7890');

    await applyProxyChange({ mode: 'system' });
    expect(process.env['HTTP_PROXY']).toBe('http://corp-proxy:3128');
    expect(process.env['no_proxy']).toBe('internal.example');
  });

  it('direct：强制清空代理 env；切回 system 仍可恢复继承值', async () => {
    process.env['HTTPS_PROXY'] = 'http://corp-proxy:3128';
    await applyProxyChange({ mode: 'direct' });
    expect(process.env['HTTPS_PROXY']).toBeUndefined();

    await applyProxyChange({ mode: 'system' });
    expect(process.env['HTTPS_PROXY']).toBe('http://corp-proxy:3128');
  });

  it('fixed + URL 凭据：注册 login 监听并只响应匹配的代理挑战', async () => {
    await applyProxyChange({
      mode: 'fixed',
      url: 'http://user:p%40ss@proxy.example:8080',
    });

    const listener = getLoginListener();
    const event = { preventDefault: vi.fn() };
    const callback = vi.fn();
    listener(event, null, {}, { isProxy: true, host: 'PROXY.EXAMPLE', port: 8080 }, callback);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('user', 'p@ss');
  });

  it('login：非代理/主机不匹配 → callback() 取消，不泄露凭据', async () => {
    await applyProxyChange({ mode: 'fixed', url: 'http://user:pass@proxy.example:8080' });
    const listener = getLoginListener();
    const event = { preventDefault: vi.fn() };
    const callback = vi.fn();

    listener(event, null, {}, { isProxy: true, host: 'evil.example', port: 8080 }, callback);
    expect(callback).toHaveBeenCalledWith();
    expect(event.preventDefault).not.toHaveBeenCalled();

    callback.mockClear();
    listener(event, null, {}, { isProxy: false, host: 'proxy.example', port: 8080 }, callback);
    expect(callback).toHaveBeenCalledWith();
  });

  it('切到 system：移除 login 监听', async () => {
    await applyProxyChange({ mode: 'fixed', url: 'http://user:pass@proxy.example:8080' });
    const listener = getLoginListener();
    await applyProxyChange({ mode: 'system' });
    expect(mocks.removeListener).toHaveBeenCalledWith('login', listener);
  });

  it('fixed 无凭据：不注册 login 监听', async () => {
    await applyProxyChange({ mode: 'fixed', url: 'http://proxy.example:8080' });
    expect(mocks.on).not.toHaveBeenCalled();
  });

  it('单分区 setProxy 失败 → warn 不抛，其余分区继续（韧性）', async () => {
    mocks.setProxy.mockRejectedValueOnce(new Error('session destroyed'));
    await expect(applyProxyChange({ mode: 'fixed', url: 'http://p:1' })).resolves.toBeUndefined();
    expect(mocks.setProxy).toHaveBeenCalledTimes(2);
  });

  it('损坏值（非对象）→ 按 system 兜底应用（fail-open），不抛', async () => {
    await expect(applyProxyChange('garbage')).resolves.toBeUndefined();
    expect(mocks.setProxy).toHaveBeenCalledTimes(2);
    for (const call of mocks.setProxy.mock.calls) {
      expect(call[0]).toEqual({ mode: 'system' });
    }
  });
});
