import { IPC_META } from '@code-agent/shared/ipc/meta';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './mock-api';

describe('mock API 契约', () => {
  it('域、方法、kind 与 IPC_META 完全一致', () => {
    const api = createMockApi() as unknown as Record<string, Record<string, unknown>>;

    expect(Object.keys(api).sort()).toEqual(Object.keys(IPC_META).sort());

    for (const [domain, methods] of Object.entries(IPC_META)) {
      for (const [method, def] of Object.entries(methods)) {
        const handler = api[domain]?.[method];
        expect(typeof handler, `${domain}.${method}`).toBe('function');

        if (def.kind === 'event') {
          expect(typeof (handler as () => unknown)()).toBe('function');
        }
      }
    }
  });

  it('request 方法返回与正式 IPC 同形的 { data }', async () => {
    const api = createMockApi();
    const response = await api.settings.getAll({});

    expect('data' in response).toBe(true);
    if ('data' in response) {
      expect(response.data.settings).toEqual(expect.any(Object));
    }
  });
});
