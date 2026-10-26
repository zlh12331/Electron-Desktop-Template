import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, subscribe } from './ipc-bridge';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invoke', () => {
  it('携带入参与每次新生成的 traceId 调用主进程', async () => {
    mocks.invoke.mockResolvedValue({ data: 42 });

    await expect(invoke('settings:getAll', { a: 1 })).resolves.toEqual({ data: 42 });

    const [channel, input, traceId] = mocks.invoke.mock.calls[0] ?? [];
    expect(channel).toBe('settings:getAll');
    expect(input).toEqual({ a: 1 });
    expect(traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('无入参时仍传 undefined 与 traceId', async () => {
    mocks.invoke.mockResolvedValue({ data: null });

    await invoke('app:getStatus');

    const [channel, input, traceId] = mocks.invoke.mock.calls[0] ?? [];
    expect(channel).toBe('app:getStatus');
    expect(input).toBeUndefined();
    expect(traceId).toBeTypeOf('string');
  });
});

describe('subscribe', () => {
  it('只把 payload 交给回调，并在退订时移除同一个 handler', () => {
    const callback = vi.fn();

    const unsubscribe = subscribe('update:event:status', callback);

    const [channel, handler] = mocks.on.mock.calls[0] as [
      string,
      (event: unknown, payload: unknown) => void,
    ];
    expect(channel).toBe('update:event:status');

    handler({ sender: 'internal' }, { phase: 'idle' });
    expect(callback).toHaveBeenCalledWith({ phase: 'idle' });
    expect(callback).toHaveBeenCalledOnce();

    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith('update:event:status', handler);
  });

  it('多个订阅各自保留独立 handler', () => {
    const first = vi.fn();
    const second = vi.fn();

    subscribe('event:one', first);
    subscribe('event:one', second);

    const handlers = mocks.on.mock.calls.map(
      (call) => call[1] as (event: unknown, p: unknown) => void,
    );
    handlers[0]?.({}, 'a');
    handlers[1]?.({}, 'b');

    expect(first).toHaveBeenCalledWith('a');
    expect(second).toHaveBeenCalledWith('b');
  });
});
