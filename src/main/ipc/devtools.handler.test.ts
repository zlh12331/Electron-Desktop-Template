import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFromWebContents, packagedState } = vi.hoisted(() => ({
  mockFromWebContents: vi.fn(),
  packagedState: { value: false },
}));

vi.mock('electron', () => ({
  ['BrowserWindow']: { fromWebContents: mockFromWebContents },
  app: {
    get isPackaged() {
      return packagedState.value;
    },
  },
}));

import { devtoolsHandlers } from './devtools.handler';

function createCtx(win: { webContents: { openDevTools: ReturnType<typeof vi.fn> } } | null) {
  const sender = { id: 1 };
  mockFromWebContents.mockReturnValue(win);
  return { sender, traceId: 'trace-1' } as never;
}

describe('devtools.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    packagedState.value = false;
  });

  it('open（默认 mode）：打开 detach 模式 DevTools', async () => {
    const openDevTools = vi.fn();
    const ctx = createCtx({ webContents: { openDevTools } });
    const result = await devtoolsHandlers.open({ mode: undefined }, ctx);
    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    expect(result).toEqual({ ok: true, mode: 'detach' });
  });

  it('open（显式 mode=right）：透传 mode', async () => {
    const openDevTools = vi.fn();
    const ctx = createCtx({ webContents: { openDevTools } });
    const result = await devtoolsHandlers.open({ mode: 'right' }, ctx);
    expect(openDevTools).toHaveBeenCalledWith({ mode: 'right' });
    expect(result).toEqual({ ok: true, mode: 'right' });
  });

  it('sender 窗口不存在：返回 ok=false 不抛错', async () => {
    const ctx = createCtx(null);
    const result = await devtoolsHandlers.open({ mode: undefined }, ctx);
    expect(result).toEqual({ ok: false, mode: 'detach' });
  });

  it('打包态拒绝打开 DevTools（与生产菜单一致）', async () => {
    packagedState.value = true;
    const openDevTools = vi.fn();
    const ctx = createCtx({ webContents: { openDevTools } });
    const result = await devtoolsHandlers.open({ mode: 'right' }, ctx);
    expect(openDevTools).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, mode: 'right' });
  });
});
