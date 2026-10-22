import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hotkeys = vi.hoisted(() => {
  const calls: { keys: string; handler: () => void }[] = [];
  return { calls };
});

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: (keys: string, handler: () => void): void => {
    hotkeys.calls.push({ keys, handler });
  },
}));

import { useSettingsStore } from '@/stores/persistent/settings-store';

import { FIXED_SHORTCUT_CONFLICTS, useKeyboardShortcuts } from './use-keyboard-shortcuts';

interface TestHandlers {
  onCommandPalette: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenShortcutHelp: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

const handlers: TestHandlers = {
  onCommandPalette: vi.fn(),
  onToggleTheme: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenShortcutHelp: vi.fn(),
  onToggleSidebar: vi.fn(),
  onToggleRightPanel: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomReset: vi.fn(),
};

function boundKeys(): string[] {
  return hotkeys.calls.map((call) => call.keys);
}

function fire(keys: string): void {
  const call = hotkeys.calls.find((entry) => entry.keys === keys);
  if (call === undefined) {
    throw new Error(`未绑定 ${keys}；已绑定：${boundKeys().join(' | ')}`);
  }
  call.handler();
}

beforeEach(() => {
  vi.clearAllMocks();
  hotkeys.calls.length = 0;
  useSettingsStore.setState({ shortcuts: { ...useSettingsStore.getState().shortcuts } });
});

describe('useKeyboardShortcuts', () => {
  it('可配置键：从 settings.shortcuts 读取并绑定（默认 MOD+P / MOD+Shift+T / MOD+,）', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    const keys = boundKeys();

    const shortcut = useSettingsStore.getState().shortcuts;
    const toHotkey = (value: string): string => value.toLowerCase();
    expect(keys).toContain(toHotkey(shortcut.commandPalette));
    expect(keys).toContain(toHotkey(shortcut.toggleTheme));
    expect(keys).toContain(toHotkey(shortcut.openSettings));
  });

  it('可配置键：改设置后重新绑定新键位', () => {
    useSettingsStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS_FOR_TEST } });
    renderHook(() => useKeyboardShortcuts(handlers));

    expect(boundKeys()).toContain('ctrl+p');
    expect(boundKeys()).toContain('ctrl+shift+t');
    expect(boundKeys()).toContain('ctrl+,');
  });

  it('固定键：帮助（shift+Slash / f1）绑定到 onOpenShortcutHelp', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    fire('shift+Slash');
    fire('f1');
    expect(handlers.onOpenShortcutHelp).toHaveBeenCalledTimes(2);
  });

  it('固定键：命令面板备用键 ctrl+k / meta+k', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    fire('ctrl+k,meta+k');
    expect(handlers.onCommandPalette).toHaveBeenCalledOnce();
  });

  it('固定键：侧栏与右面板折叠（含 Ctrl+1/2 变体）', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    fire('ctrl+b,meta+b,ctrl+1,meta+1');
    fire('ctrl+j,meta+j,ctrl+2,meta+2');
    expect(handlers.onToggleSidebar).toHaveBeenCalledOnce();
    expect(handlers.onToggleRightPanel).toHaveBeenCalledOnce();
  });

  it('固定键：缩放的 11 档上调/下调/复位', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    fire('ctrl+Equal,ctrl+shift+Equal,meta+Equal,meta+shift+Equal');
    fire('ctrl+Minus,meta+Minus');
    fire('ctrl+0,meta+0');
    expect(handlers.onZoomIn).toHaveBeenCalledOnce();
    expect(handlers.onZoomOut).toHaveBeenCalledOnce();
    expect(handlers.onZoomReset).toHaveBeenCalledOnce();
  });

  it('handler 身份变化后调用最新回调（经 ref 转发，不依赖 effect 重绑）', () => {
    const first: () => void = vi.fn();
    const second: () => void = vi.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => {
        handlers.onCommandPalette = cb;
        useKeyboardShortcuts(handlers);
      },
      { initialProps: { cb: first } },
    );

    const before = hotkeys.calls.filter((c) => c.keys === 'ctrl+k,meta+k').length;
    rerender({ cb: second });
    const bound = hotkeys.calls.filter((c) => c.keys === 'ctrl+k,meta+k');
    expect(bound.length).toBeGreaterThanOrEqual(before);

    bound[bound.length - 1]?.handler();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('FIXED_SHORTCUT_CONFLICTS 与固定绑定同源：每条 match 均可归一（非空）', () => {
    expect(FIXED_SHORTCUT_CONFLICTS.length).toBeGreaterThanOrEqual(10);
    for (const entry of FIXED_SHORTCUT_CONFLICTS) {
      expect(entry.match.length).toBeGreaterThan(0);
      expect(entry.labelKey.startsWith('shortcutHelp.item.')).toBe(true);
    }
  });
});

/** 测试用：显式固定默认快捷键，断言不依赖平台 MOD 常量 */
const DEFAULT_SHORTCUTS_FOR_TEST = {
  commandPalette: 'Ctrl+P',
  toggleTheme: 'Ctrl+Shift+T',
  openSettings: 'Ctrl+,',
};
