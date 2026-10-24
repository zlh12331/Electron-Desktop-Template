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

  it('普通 URL 认证、敏感 query 和带引号 key=value 不依赖密钥形态', () => {
    expect(
      redactText(
        'https://alice:abc@example.invalid/path?password=abc&route=home&access_token=def#ok',
      ),
    ).toBe(
      'https://[REDACTED]@example.invalid/path?password=[REDACTED]&route=home&access_token=[REDACTED]#ok',
    );
    expect(redactText('password=abc token="plain value" api_key=def')).toBe(
      'password=[REDACTED] token=[REDACTED] api_key=[REDACTED]',
    );
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
      credentials: string;
      items: Record<string, unknown>[];
    };
    expect(result.credentials).toBe('[REDACTED]');
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

  it('敏感容器整体替换，getter 不执行且原引用不留在结果里', () => {
    const input = {
      password: ['abc', { nested: 'def' }],
      get credentials(): never {
        throw new Error('must not read');
      },
      get bad(): never {
        throw new Error('must not read');
      },
      safe: { value: 'ok' },
    };
    const result = redactSensitive(input) as Record<string, unknown>;
    expect(result).toEqual({
      password: '[REDACTED]',
      credentials: '[REDACTED]',
      bad: '[Unserializable]',
      safe: { value: 'ok' },
    });
    expect(result['safe']).not.toBe(input.safe);
  });

  it('循环、深层、宽数组和坏代理都可安全序列化', () => {
    const cycle: Record<string, unknown> = { password: 'abc' };
    cycle['self'] = cycle;
    expect(redactSensitive(cycle)).toEqual({ password: '[REDACTED]', self: '[Circular]' });
    let deep: unknown = { password: 'abc' };
    for (let i = 0; i < 100; i += 1) {
      deep = { child: deep };
    }
    expect(JSON.stringify(redactSensitive(deep))).toContain('[Truncated]');
    expect(
      (redactSensitive(Array.from({ length: 10_000 }, () => cycle)) as unknown[]).length,
    ).toBeLessThanOrEqual(128);
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(() => redactSensitive(proxy.proxy)).not.toThrow();
    expect(redactSensitive(proxy.proxy)).toBe('[Unserializable]');
  });
});
