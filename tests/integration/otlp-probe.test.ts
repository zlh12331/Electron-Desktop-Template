import { createServer } from 'node:http';
import { probeOtlpTargets, safeDisplayUrl } from '@code-agent/shared/observability';
import { afterEach, describe, expect, it } from 'vitest';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('safeDisplayUrl', () => {
  it('去掉 query（可能含 token）', () => {
    expect(safeDisplayUrl('https://example.com/v1/traces?token=secret')).toBe(
      'https://example.com/v1/traces?redacted',
    );
  });

  it('非法 URL 原样返回', () => {
    expect(safeDisplayUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('probeOtlpTargets', () => {
  it('并发探测：2xx 记为可达，非 2xx 记录状态码', async () => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === '/v1/traces' ? 200 : 503, {
        'content-type': 'application/json',
      });
      response.end('{}');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('no port');
    }
    const base = `http://127.0.0.1:${address.port}`;
    const results = await probeOtlpTargets([
      { signal: 'traces', url: `${base}/v1/traces` },
      { signal: 'logs', url: `${base}/v1/logs` },
    ]);
    expect(results[0]).toMatchObject({ ok: true, statusCode: 200 });
    expect(results[1]).toMatchObject({ ok: false, statusCode: 503 });
  });

  it('不可达地址返回失败而不抛错', async () => {
    const results = await probeOtlpTargets([
      { signal: 'traces', url: 'http://127.0.0.1:1/v1/traces' },
    ]);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.statusCode).toBeNull();
  });
});
