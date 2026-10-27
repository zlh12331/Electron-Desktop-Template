import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS_SECTION } from '@/lib/settings-sections';

import { useUiStore } from './ui-store';

const INITIAL = useUiStore.getState();

beforeEach(() => {
  useUiStore.setState(INITIAL, true);
});

describe('ui-store（纯 UI 态，不持久化）', () => {
  it('设置：默认关闭且无直达分区', () => {
    expect(useUiStore.getState().settingsOpen).toBe(false);
    expect(useUiStore.getState().settingsSection).toBeNull();
  });

  it('设置：openSettings 无参 → 打开并清空直达分区（回落默认分区）', () => {
    useUiStore.getState().setSettingsSection('beta');
    useUiStore.getState().openSettings();

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useUiStore.getState().settingsSection).toBeNull();
    expect(DEFAULT_SETTINGS_SECTION).toBe('general');
  });

  it('设置：openSettings(section) → 打开并直达指定分区', () => {
    useUiStore.getState().openSettings('notification');

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useUiStore.getState().settingsSection).toBe('notification');
  });

  it('设置：closeSettings 只关面板，保留上次分区（下次可继续直达）', () => {
    useUiStore.getState().openSettings('proxy');
    useUiStore.getState().closeSettings();

    expect(useUiStore.getState().settingsOpen).toBe(false);
    expect(useUiStore.getState().settingsSection).toBe('proxy');
  });

  it('命令面板：open / close 独立于设置面板', () => {
    useUiStore.getState().openPalette();
    expect(useUiStore.getState().paletteOpen).toBe(true);
    expect(useUiStore.getState().settingsOpen).toBe(false);

    useUiStore.getState().closePalette();
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('快捷键帮助：open / close 与命令面板互不影响', () => {
    useUiStore.getState().openShortcutHelp();
    useUiStore.getState().openPalette();

    expect(useUiStore.getState().shortcutHelpOpen).toBe(true);
    expect(useUiStore.getState().paletteOpen).toBe(true);

    useUiStore.getState().closeShortcutHelp();
    expect(useUiStore.getState().shortcutHelpOpen).toBe(false);
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });

  it('侧栏：默认展开；toggle 一次折叠并置 manual', () => {
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    expect(useUiStore.getState().sidebarManual).toBe(false);

    useUiStore.getState().toggleSidebar();

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(useUiStore.getState().sidebarManual).toBe(true);
  });

  it('右面板：模板默认收起（无内容）；toggle 一次展开并置 manual', () => {
    expect(useUiStore.getState().rightPanelCollapsed).toBe(true);

    useUiStore.getState().toggleRightPanel();

    expect(useUiStore.getState().rightPanelCollapsed).toBe(false);
    expect(useUiStore.getState().rightPanelManual).toBe(true);
  });

  it('断点自动折叠：set*Collapsed 不置 manual（不覆盖用户手动意图）', () => {
    useUiStore.getState().setSidebarCollapsed(true);
    useUiStore.getState().setRightPanelCollapsed(false);

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(useUiStore.getState().rightPanelCollapsed).toBe(false);
    expect(useUiStore.getState().sidebarManual).toBe(false);
    expect(useUiStore.getState().rightPanelManual).toBe(false);
  });

  it('toggle 往返：两次切换回到原态，manual 保持 true', () => {
    useUiStore.getState().toggleSidebar();
    useUiStore.getState().toggleSidebar();

    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    expect(useUiStore.getState().sidebarManual).toBe(true);
  });
});
