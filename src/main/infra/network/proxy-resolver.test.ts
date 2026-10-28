import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildChromiumProxyConfig,
  buildProxyUrl,
  maskProxyUrl,
  normalizeProxyHost,
  parseProxyConfig,
  resolveProxyAuth,
  shouldBypass,
} from './proxy-resolver';

describe('parseProxyConfig', () => {
  it('V1 缺失/损坏 → mode=system（fail-open 向既有行为）', () => {
    expect(parseProxyConfig(undefined)).toEqual({ mode: 'system' });
    expect(parseProxyConfig('garbage')).toEqual({ mode: 'system' });
    expect(parseProxyConfig(42)).toEqual({ mode: 'system' });
    expect(parseProxyConfig(['fixed'])).toEqual({ mode: 'system' });
  });

  it('结构化 fixed → 保留协议/主机/端口/bypass，主机归一化', () => {
    expect(
      parseProxyConfig({
        mode: 'fixed',
        protocol: 'http',
        host: 'Proxy.Example',
        port: 7890,
        bypass: ['corp.example'],
      }),
    ).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: 'proxy.example',
      port: 7890,
      bypass: ['corp.example'],
    });
  });

  it('旧版 URL 形态 → 结构化字段 + 凭据（启动迁移兼容）', () => {
    expect(
      parseProxyConfig({ mode: 'fixed', url: 'http://alice:p%40ss@proxy.example:8080' }),
    ).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: 'proxy.example',
      port: 8080,
      auth: { username: 'alice', password: 'p@ss' },
    });
  });

  it('SOCKS5 接受无认证配置，认证字段被丢弃（Chromium 限制）', () => {
    expect(
      parseProxyConfig({
        mode: 'fixed',
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        auth: { username: 'u', password: 'p' },
      }),
    ).toEqual({ mode: 'fixed', protocol: 'socks5', host: '127.0.0.1', port: 1080 });
  });

  it('字段非法（缺项 / 非法协议 / 非法主机）→ 整体回 system', () => {
    expect(parseProxyConfig({ mode: 'quick' })).toEqual({ mode: 'system' });
    expect(parseProxyConfig({ mode: 'fixed', protocol: 'http', host: 'p' })).toEqual({
      mode: 'system',
    });
    expect(parseProxyConfig({ mode: 'fixed', protocol: 'ftp', host: 'p', port: 1 })).toEqual({
      mode: 'system',
    });
    expect(
      parseProxyConfig({ mode: 'fixed', protocol: 'http', host: 'http://p', port: 1 }),
    ).toEqual({ mode: 'system' });
  });
});

describe('resolveProxyAuth', () => {
  it('无凭据/端点不完整 → null', () => {
    expect(resolveProxyAuth({ mode: 'system' })).toBeNull();
    expect(resolveProxyAuth({ mode: 'fixed', protocol: 'http', host: 'p', port: 8080 })).toBeNull();
  });

  it('返回规范化主机 + 凭据', () => {
    expect(
      resolveProxyAuth({
        mode: 'fixed',
        protocol: 'http',
        host: 'PROXY.example',
        port: 8080,
        auth: { username: 'user', password: 'pass' },
      }),
    ).toEqual({ host: 'proxy.example', port: 8080, username: 'user', password: 'pass' });
  });

  it('normalizeProxyHost：IPv6 去括号 + 小写', () => {
    expect(normalizeProxyHost('[::1]')).toBe('::1');
    expect(normalizeProxyHost('PROXY.EXAMPLE')).toBe('proxy.example');
  });
});

describe('buildChromiumProxyConfig', () => {
  it('system → {mode: system}；direct → {mode: direct}', () => {
    expect(buildChromiumProxyConfig({ mode: 'system' })).toEqual({ mode: 'system' });
    expect(buildChromiumProxyConfig({ mode: 'direct' })).toEqual({ mode: 'direct' });
  });

  it('HTTP 固定代理 → 单 proxyURL + 强制 <local> bypass', () => {
    expect(
      buildChromiumProxyConfig({
        mode: 'fixed',
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
        bypass: ['corp.example'],
      }),
    ).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<local>;corp.example',
    });
  });

  it('HTTPS / SOCKS5 固定代理 → 对应协议 URL', () => {
    expect(
      buildChromiumProxyConfig({
        mode: 'fixed',
        protocol: 'https',
        host: 'proxy.example',
        port: 443,
      }).proxyRules,
    ).toBe('https://proxy.example:443');
    expect(
      buildChromiumProxyConfig({
        mode: 'fixed',
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      }).proxyRules,
    ).toBe('socks5://127.0.0.1:1080');
  });

  it('fixed 但字段缺失（防御）→ 回 system 映射', () => {
    expect(buildChromiumProxyConfig({ mode: 'fixed' })).toEqual({ mode: 'system' });
  });
});

describe('buildProxyUrl', () => {
  it('fixed → 协议 URL（keychain / env 侧门共用）', () => {
    expect(buildProxyUrl({ mode: 'fixed', protocol: 'http', host: '127.0.0.1', port: 7890 })).toBe(
      'http://127.0.0.1:7890',
    );
    expect(buildProxyUrl({ mode: 'fixed', protocol: 'socks5', host: '[::1]', port: 1080 })).toBe(
      'socks5://[::1]:1080',
    );
  });

  it('带认证 → userinfo 编码保留', () => {
    expect(
      buildProxyUrl({
        mode: 'fixed',
        protocol: 'http',
        host: '10.0.0.1',
        port: 8080,
        auth: { username: 'u@ser', password: 'p@ss' },
      }),
    ).toBe('http://u%40ser:p%40ss@10.0.0.1:8080');
  });

  it('system/direct → undefined', () => {
    expect(buildProxyUrl({ mode: 'system' })).toBeUndefined();
    expect(buildProxyUrl({ mode: 'direct' })).toBeUndefined();
  });
});

describe('shouldBypass', () => {
  const cfg = {
    mode: 'fixed' as const,
    protocol: 'http' as const,
    host: 'p',
    port: 1,
    bypass: ['corp.example', '10.0.0.0/8', '192.168.1.0/24', '2001:db8::/32', '*.wild.example'],
  };

  it('V4 localhost 家族恒绕过（硬规则）', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:9374/health',
      'http://[::1]:8080/x',
    ]) {
      expect(shouldBypass(cfg, url)).toBe(true);
    }
  });

  it('域名后缀 / 通配前缀', () => {
    expect(shouldBypass(cfg, 'http://api.corp.example/v1')).toBe(true);
    expect(shouldBypass(cfg, 'http://corp.example:8080/x')).toBe(true);
    expect(shouldBypass(cfg, 'http://evil-corp.example.com/')).toBe(false);
    expect(shouldBypass(cfg, 'http://a.wild.example/')).toBe(true);
  });

  it('IPv4 / IPv6 CIDR', () => {
    expect(shouldBypass(cfg, 'http://10.1.2.3/')).toBe(true);
    expect(shouldBypass(cfg, 'http://192.168.1.99/')).toBe(true);
    expect(shouldBypass(cfg, 'http://192.168.2.1/')).toBe(false);
    expect(shouldBypass(cfg, 'http://[2001:db8::1]/')).toBe(true);
    expect(shouldBypass(cfg, 'http://[2001:db9::1]/')).toBe(false);
  });

  it('非 fixed 模式恒 false', () => {
    expect(shouldBypass({ mode: 'system' }, 'http://localhost:1')).toBe(false);
  });
});

describe('maskProxyUrl（安全：凭据不落日志）', () => {
  it('带凭据 URL 脱敏；无凭据/非法 URL 原样', () => {
    expect(maskProxyUrl('http://user:pass@10.0.0.1:8080')).toBe('http://***@10.0.0.1:8080');
    expect(maskProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
    expect(maskProxyUrl('not-a-url')).toBe('not-a-url');
  });
});
