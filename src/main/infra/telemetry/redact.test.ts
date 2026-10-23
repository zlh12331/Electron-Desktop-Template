import { describe, expect, it } from 'vitest';

import { redactSensitive, redactText } from './redact';

describe('redactText', () => {
  it('sk- / Bearer / PEM / 32+ hex 全部脱敏', () => {
    expect(redactText('key=sk-abcdefghijklmnop')).toBe('key=sk-[REDACTED]');
    expect(redactText('Authorization: Bearer abcdefghijkl')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(redactText('-----BEGIN RSA PRIVATE KEY-----')).toBe('[REDACTED PRIVATE KEY]');
    expect(redactText('hash 0123456789abcdef0123456789abcdef')).toBe('hash [REDACTED]');
  });

  it('普通文本原样返回', () => {
    expect(redactText('hello world')).toBe('hello world');
  });
});

describe('redactSensitive', () => {
  it('敏感键整体替换，普通键透传', () => {
    expect(redactSensitive('anything', 'apiKey')).toBe('[REDACTED]');
    expect(redactSensitive('anything', 'access_token')).toBe('[REDACTED]');
    expect(redactSensitive('deepseek', 'provider')).toBe('deepseek');
  });

  it('嵌套对象/数组逐层处理且不修改入参', () => {
    const input = {
      credentials: { apiKey: 'secret', baseUrl: 'https://example.com' },
      items: [{ token: 'a' }, { name: 'keep' }],
    };
    const result = redactSensitive(input) as {
      credentials: Record<string, unknown>;
      items: Record<string, unknown>[];
    };
    expect(result.credentials['apiKey']).toBe('[REDACTED]');
    expect(result.credentials['baseUrl']).toBe('https://example.com');
    expect(result.items[0]).toEqual({ token: '[REDACTED]' });
    expect(result.items[1]).toEqual({ name: 'keep' });
    expect(input.credentials.apiKey).toBe('secret');
  });

  it('字符串叶子按值形态脱敏', () => {
    expect(redactSensitive({ note: 'token sk-abcdefghijklmnop' })).toEqual({
      note: 'token sk-[REDACTED]',
    });
  });

  it('null / undefined / 数字原样返回', () => {
    expect(redactSensitive(null, 'x')).toBeNull();
    expect(redactSensitive(undefined, 'x')).toBeUndefined();
    expect(redactSensitive(42, 'x')).toBe(42);
  });
});
