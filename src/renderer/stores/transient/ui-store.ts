import { create } from 'zustand';

import type { SettingsSectionId } from '@/lib/settings-sections';

interface UiState {
  /** 设置对话框是否打开 */
  readonly settingsOpen: boolean;
  /** 打开设置对话框（可指定直达分区；缺省 null = 用默认分区） */
  readonly openSettings: (section?: SettingsSectionId) => void;
  /** 关闭设置对话框 */
  readonly closeSettings: () => void;
  /** 设置抽屉当前分区（null = 默认分区；多入口直达用） */
  readonly settingsSection: SettingsSectionId | null;
  /** 设置设置抽屉分区（导航点击） */
  readonly setSettingsSection: (section: SettingsSectionId) => void;
  /** 命令面板是否打开（多入口：顶栏按钮 / Ctrl+P / Ctrl+K / 错误动作；集中到 store 避免双模式） */
  readonly paletteOpen: boolean;
  /** 打开命令面板 */
  readonly openPalette: () => void;
  /** 关闭命令面板 */
  readonly closePalette: () => void;
  /** 快捷键帮助对话框是否打开（多入口：顶栏快捷键 / F1 / '?'；集中到 store 保证单实例） */
  readonly shortcutHelpOpen: boolean;
  /** 打开快捷键帮助对话框 */
  readonly openShortcutHelp: () => void;
  /** 关闭快捷键帮助对话框 */
  readonly closeShortcutHelp: () => void;

  /** 左侧栏是否折叠 */
  readonly sidebarCollapsed: boolean;
  /** 右侧栏是否折叠 */
  readonly rightPanelCollapsed: boolean;
  /** 用户是否手动操作过侧栏（断点自动折叠不再覆盖手动意图） */
  readonly sidebarManual: boolean;
  /** 用户是否手动操作过右面板 */
  readonly rightPanelManual: boolean;
  /** 设置侧栏折叠态 */
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  /** 设置右面板折叠态 */
  readonly setRightPanelCollapsed: (collapsed: boolean) => void;
  /** 切换侧栏折叠（置位 manual，断点不再覆盖） */
  readonly toggleSidebar: () => void;
  /** 切换右面板折叠（置位 manual，断点不再覆盖） */
  readonly toggleRightPanel: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  settingsOpen: false,
  settingsSection: null,
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? null }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  shortcutHelpOpen: false,
  openShortcutHelp: () => set({ shortcutHelpOpen: true }),
  closeShortcutHelp: () => set({ shortcutHelpOpen: false }),

  sidebarCollapsed: false,
  // 模板无右栏内容，默认收起；接入工作区面板后改为 false
  rightPanelCollapsed: true,
  sidebarManual: false,
  rightPanelManual: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed, sidebarManual: true })),
  toggleRightPanel: () =>
    set((state) => ({
      rightPanelCollapsed: !state.rightPanelCollapsed,
      rightPanelManual: true,
    })),
}));
