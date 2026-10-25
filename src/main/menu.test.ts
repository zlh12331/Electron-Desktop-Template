import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  packaged: true,
  build: vi.fn((template: unknown) => template),
  set: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return mocks.packaged;
    },
  },
  // biome-ignore lint/style/useNamingConvention: mock electron Menu API，需匹配 SDK 原名
  Menu: {
    buildFromTemplate: mocks.build,
    setApplicationMenu: mocks.set,
  },
}));

vi.mock('./utils/logger', () => ({ logger: { info: vi.fn() } }));

import { installProductionMenu } from './menu';

describe('installProductionMenu', () => {
  beforeEach(() => {
    mocks.packaged = true;
    mocks.build.mockClear();
    mocks.set.mockClear();
  });

  it('打包态：安装不含 View 的最小菜单', () => {
    installProductionMenu();

    expect(mocks.build).toHaveBeenCalledOnce();
    const template = mocks.build.mock.calls[0]?.[0] as Array<{ role?: string }>;
    expect(template.map((item) => item.role)).not.toContain('viewMenu');
    expect(mocks.set).toHaveBeenCalledOnce();
  });

  it('开发态：保留 Electron 默认菜单（不覆盖）', () => {
    mocks.packaged = false;
    installProductionMenu();

    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
