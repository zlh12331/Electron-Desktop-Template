import { DEFAULT_ZOOM, stepZoom } from '@code-agent/shared/renderer';
import { MotionConfig } from 'motion/react';
import { lazy, type ReactElement, type ReactNode, Suspense, useEffect, useState } from 'react';
import { DialogHost } from '@/components/common/DialogHost';
import { SectionErrorBoundary } from '@/components/common/SectionErrorBoundary';
import { UpdateNotice } from '@/components/common/UpdateNotice';
import { Spinner } from '@/components/ui/spinner';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useLayoutBreakpoint } from '@/hooks/use-layout-breakpoint';
import { useResizablePanels } from '@/hooks/use-resizable-panels';
import { useTranslation } from '@/i18n/use-translation';
import { cn } from '@/lib/utils';
import { nextTheme, useSettingsStore } from '@/stores/persistent/settings-store';
import { useUiStore } from '@/stores/transient/ui-store';
import { useAppBridges } from './bridges';
import {
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from './layout-utils';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const LazySettingsDialog = lazy(async () => {
  const mod = await import('@/components/settings/SettingsDialog');
  return { default: mod.SettingsDialog };
});
const LazyCommandPalette = lazy(async () => {
  const mod = await import('@/components/common/CommandPalette');
  return { default: mod.CommandPalette };
});
const LazyShortcutHelpDialog = lazy(async () => {
  const mod = await import('@/components/common/ShortcutHelpDialog');
  return { default: mod.ShortcutHelpDialog };
});

/** 懒加载浮层的统一占位：避免首次打开设置/命令面板时出现空白帧 */
function LazyOverlayFallback(): ReactElement {
  return (
    <div className="bg-overlay-bg fixed inset-0 z-popover flex items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

interface AppShellProps {
  /** 主内容区（通常由 RouterProvider 通过 <Outlet /> 传入） */
  children: ReactNode;
}

/**
 * 应用根布局：Topbar + Sidebar + 主内容区 + 右面板
 *
 * 模板版右面板默认折叠且无内容（模板无终端/浏览器/文件查看面板）；
 * 需要右侧工作区时在 layout/ 下新增面板组件并在此挂载。
 */
export function AppShell({ children }: AppShellProps): ReactElement {
  const { t } = useTranslation();
  useAppBridges();

  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const sidebarManual = useUiStore((s) => s.sidebarManual);
  const rightPanelManual = useUiStore((s) => s.rightPanelManual);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const setRightPanelCollapsed = useUiStore((s) => s.setRightPanelCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);

  const { isCompact, isNarrow } = useLayoutBreakpoint();

  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const closeSettings = useUiStore((s) => s.closeSettings);
  // 首次打开前不挂载 lazy 弹层：避免启动即请求 1MB+ 的 SettingsDialog chunk。
  // 打开过一次后保持挂载，这样关闭动画/内部状态不会因卸载被截断。
  const [settingsMounted, setSettingsMounted] = useState(settingsOpen);
  useEffect(() => {
    if (settingsOpen) {
      setSettingsMounted(true);
    }
  }, [settingsOpen]);
  useEffect(() => {
    // 只在紧凑模式下自动收起；非紧凑不主动展开（模板默认无右栏内容，
    // 强制展开会留出空白区）。接入工作区面板后按需改回 isCompact 双向联动。
    if (!rightPanelManual && isCompact) {
      setRightPanelCollapsed(true);
    }
  }, [isCompact, rightPanelManual, setRightPanelCollapsed]);
  useEffect(() => {
    if (!sidebarManual) {
      setSidebarCollapsed(isNarrow);
    }
  }, [isNarrow, sidebarManual, setSidebarCollapsed]);

  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const openPalette = useUiStore((s) => s.openPalette);
  const closePalette = useUiStore((s) => s.closePalette);
  const [paletteMounted, setPaletteMounted] = useState(paletteOpen);
  useEffect(() => {
    if (paletteOpen) {
      setPaletteMounted(true);
    }
  }, [paletteOpen]);

  const shortcutHelpOpen = useUiStore((s) => s.shortcutHelpOpen);
  const closeShortcutHelp = useUiStore((s) => s.closeShortcutHelp);
  const openShortcutHelp = useUiStore((s) => s.openShortcutHelp);
  const [shortcutHelpMounted, setShortcutHelpMounted] = useState(shortcutHelpOpen);
  useEffect(() => {
    if (shortcutHelpOpen) {
      setShortcutHelpMounted(true);
    }
  }, [shortcutHelpOpen]);

  const setTheme = useSettingsStore((s) => s.setTheme);
  const theme = useSettingsStore((s) => s.theme);
  const openSettings = useUiStore((s) => s.openSettings);

  useKeyboardShortcuts({
    onCommandPalette: () => openPalette(),
    onToggleTheme: () => {
      setTheme(nextTheme(theme));
    },
    onOpenSettings: openSettings,
    onOpenShortcutHelp: openShortcutHelp,
    onToggleSidebar: toggleSidebar,
    onToggleRightPanel: toggleRightPanel,
    onZoomIn: () => {
      const { appearance, updateAppearance } = useSettingsStore.getState();
      updateAppearance({ zoom: stepZoom(appearance.zoom, 1) });
    },
    onZoomOut: () => {
      const { appearance, updateAppearance } = useSettingsStore.getState();
      updateAppearance({ zoom: stepZoom(appearance.zoom, -1) });
    },
    onZoomReset: () => {
      useSettingsStore.getState().updateAppearance({ zoom: DEFAULT_ZOOM });
    },
  });

  const { sidebarWidth, rightPanelWidth, draggingSide, onResizerMouseDown, onResizerKeyDown } =
    useResizablePanels(sidebarCollapsed, rightPanelCollapsed);

  return (
    <MotionConfig reducedMotion="user">
      <div className="bg-background text-foreground app font-sans">
        <a
          href="#main-content"
          className="bg-background text-foreground sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-boundary focus:rounded focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
        >
          {t('common.skipToContent')}
        </a>
        <Topbar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          rightPanelCollapsed={rightPanelCollapsed}
          onToggleRightPanel={toggleRightPanel}
          onOpenCommandPalette={openPalette}
        />
        <div
          className={cn(
            'app-layout',
            sidebarCollapsed && 'sb-collapsed',
            rightPanelCollapsed && 'crp-collapsed',
          )}
        >
          <SectionErrorBoundary name="sidebar">
            <Sidebar />
          </SectionErrorBoundary>

          {!sidebarCollapsed && (
            <hr
              aria-orientation="vertical"
              aria-label={t('common.sidebarResizer')}
              aria-valuenow={sidebarWidth}
              aria-valuemin={SIDEBAR_WIDTH_MIN}
              aria-valuemax={SIDEBAR_WIDTH_MAX}
              tabIndex={0}
              className={cn('resizer resizer-left', draggingSide === 'left' && 'dragging')}
              onMouseDown={onResizerMouseDown('left')}
              onKeyDown={onResizerKeyDown('left')}
            />
          )}

          <main id="main-content" className="main-surface paper-texture">
            <SectionErrorBoundary name="main-content">{children}</SectionErrorBoundary>
          </main>

          {!rightPanelCollapsed && (
            <hr
              aria-orientation="vertical"
              aria-label={t('common.panelResizer')}
              aria-valuenow={rightPanelWidth}
              aria-valuemin={RIGHT_PANEL_WIDTH_MIN}
              aria-valuemax={RIGHT_PANEL_WIDTH_MAX}
              tabIndex={0}
              className={cn('resizer resizer-right', draggingSide === 'right' && 'dragging')}
              onMouseDown={onResizerMouseDown('right')}
              onKeyDown={onResizerKeyDown('right')}
            />
          )}

          <aside className="right-panel" aria-label={t('common.rightPanel')} />
        </div>

        <DialogHost />

        {settingsMounted && (
          <Suspense fallback={<LazyOverlayFallback />}>
            <LazySettingsDialog open={settingsOpen} onOpenChange={closeSettings} />
          </Suspense>
        )}

        {paletteMounted && (
          <Suspense fallback={<LazyOverlayFallback />}>
            <LazyCommandPalette open={paletteOpen} onOpenChange={closePalette} />
          </Suspense>
        )}
        {shortcutHelpMounted && (
          <Suspense fallback={<LazyOverlayFallback />}>
            <LazyShortcutHelpDialog open={shortcutHelpOpen} onClose={closeShortcutHelp} />
          </Suspense>
        )}
        <UpdateNotice />
      </div>
    </MotionConfig>
  );
}
