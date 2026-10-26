import { IPC_META } from '@code-agent/shared/ipc/meta';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createIpcApi } from './create-api';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('./ipc-bridge', () => ({
  invoke: mocks.invoke,
  subscribe: mocks.subscribe,
}));

type ApiShape = Record<string, Record<string, (...args: unknown[]) => unknown>>;

const api = createIpcApi(IPC_META) as unknown as ApiShape;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue({ data: { ok: true } });
});

describe('createIpcApi', () => {
  it('把 IPC_META 的每个域与方法都暴露为函数', () => {
    for (const [domain, methods] of Object.entries(IPC_META)) {
      expect(api[domain]).toBeTypeOf('object');
      for (const method of Object.keys(methods)) {
        expect(api[domain]?.[method]).toBeTypeOf('function');
      }
    }
  });

  it('request 方法把 channel 与入参交给 invoke', async () => {
    const channel = IPC_META.app.getStatus.channel;
    await api['app']?.['getStatus']?.({ probe: true });

    expect(mocks.invoke).toHaveBeenCalledWith(channel, { probe: true });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('event 方法把 channel 与回调交给 subscribe，并透传退订函数', () => {
    const channel = IPC_META.app.subscribeDeepLink.channel;
    const callback = vi.fn();
    const unsubscribe = vi.fn();
    mocks.subscribe.mockReturnValue(unsubscribe);

    const result = api['app']?.['subscribeDeepLink']?.(callback);

    expect(mocks.subscribe).toHaveBeenCalledWith(channel, callback);
    expect(result).toBe(unsubscribe);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
