import { describe, expect, it } from 'vitest';

import { ProxySettingInputSchema } from '../schemas/settings';

const FIXED = {
  mode: 'fixed' as const,
  protocol: 'http' as const,
  host: 'proxy.example',
  port: 8080,
};

describe('ProxySettingInputSchema', () => {
  it('接受 system/direct 与三种协议', () => {
    for (const value of [
      { mode: 'system' },
      { mode: 'direct' },
      FIXED,
      { ...FIXED, protocol: 'https' },
      { ...FIXED, protocol: 'socks5' },
      { ...FIXED, host: '::1', port: 1 },
      { ...FIXED, port: 65535, bypass: ['corp.example', '10.0.0.0/8', '<local>'] },
      { ...FIXED, auth: { username: 'u', password: 'p' } },
    ]) {
      expect(ProxySettingInputSchema.safeParse(value).success).toBe(true);
    }
  });

  it('fixed 缺 protocol/host/port 拒绝', () => {
    for (const value of [
      { mode: 'fixed', host: 'proxy.example', port: 8080 },
      { mode: 'fixed', protocol: 'http', port: 8080 },
      { mode: 'fixed', protocol: 'http', host: 'proxy.example' },
    ]) {
      expect(ProxySettingInputSchema.safeParse(value).success).toBe(false);
    }
  });

  it('非法主机拒绝（空白 / 路径 / 方括号 / 非法字符）', () => {
    for (const host of ['bad host', 'http://proxy', '[::1]', 'bad!host']) {
      expect(ProxySettingInputSchema.safeParse({ ...FIXED, host }).success).toBe(false);
    }
  });

  it('非法端口拒绝', () => {
    for (const port of [0, 65536, 1.5]) {
      expect(ProxySettingInputSchema.safeParse({ ...FIXED, port }).success).toBe(false);
    }
  });

  it('SOCKS5 认证拒绝', () => {
    expect(
      ProxySettingInputSchema.safeParse({
        ...FIXED,
        protocol: 'socks5',
        auth: { username: 'u', password: 'p' },
      }).success,
    ).toBe(false);
  });

  it('bypass 空白项 / 超 64 条拒绝', () => {
    expect(ProxySettingInputSchema.safeParse({ ...FIXED, bypass: ['bad entry'] }).success).toBe(
      false,
    );
    expect(
      ProxySettingInputSchema.safeParse({
        ...FIXED,
        bypass: Array.from({ length: 65 }, (_, index) => `h${index}.example`),
      }).success,
    ).toBe(false);
  });

  it('auth 字段超长 / 协议未知拒绝', () => {
    expect(
      ProxySettingInputSchema.safeParse({
        ...FIXED,
        auth: { username: 'u'.repeat(257), password: 'p' },
      }).success,
    ).toBe(false);
    expect(
      ProxySettingInputSchema.safeParse({
        ...FIXED,
        auth: { username: 'u', password: 'p'.repeat(1025) },
      }).success,
    ).toBe(false);
    expect(ProxySettingInputSchema.safeParse({ ...FIXED, protocol: 'ftp' }).success).toBe(false);
  });
});
