import { beforeEach, describe, expect, it, vi } from 'vitest';

type Definition = {
  readonly kind: 'request' | 'event';
  readonly channel: string;
  readonly schema: unknown;
  readonly resSchema?: unknown;
};

const mocks = vi.hoisted(() => ({
  wrap: vi.fn(),
}));

const definitions = vi.hoisted(() => ({
  app: {} as Record<string, Definition>,
}));

vi.mock('@code-agent/shared/main', () => ({
  // biome-ignore lint/style/useNamingConvention: 必须与 shared 模块导出名一致
  IPC_DEFINITIONS: definitions,
}));

vi.mock('./wrap', () => ({
  wrap: mocks.wrap,
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerIpcHandlers } from './register';

function setDefinitions(entries: Record<string, Definition>): void {
  definitions.app = entries;
}

const okHandler = async (): Promise<{ ok: boolean }> => ({ ok: true });

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefinitions({
      ok: { kind: 'request', channel: 'app:ok', schema: null, resSchema: {} },
      push: { kind: 'event', channel: 'app:event:push', schema: null, resSchema: {} },
    });
  });

  it('只注册 request，事件通道跳过', () => {
    registerIpcHandlers({ app: { ok: okHandler } } as never);
    expect(mocks.wrap).toHaveBeenCalledTimes(1);
    expect(mocks.wrap).toHaveBeenCalledWith('app:ok', null, okHandler, {});
  });

  it('handler 缺失：启动期直接抛错', () => {
    setDefinitions({
      missing: { kind: 'request', channel: 'app:missing', schema: null, resSchema: {} },
    });
    expect(() => registerIpcHandlers({ app: {} } as never)).toThrow(/handler 缺失/);
  });

  it('响应契约缺失：启动期直接抛错', () => {
    setDefinitions({
      broken: { kind: 'request', channel: 'app:broken', schema: null, resSchema: undefined },
    });
    expect(() => registerIpcHandlers({ app: { broken: okHandler } } as never)).toThrow(
      /响应契约缺失/,
    );
  });
});
