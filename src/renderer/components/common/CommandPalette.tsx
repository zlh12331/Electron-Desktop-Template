import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from 'cmdk';
import { Moon, Search, Settings2, Sun } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/use-translation';
import { useSettingsStore } from '@/stores/persistent/settings-store';
import { useUiStore } from '@/stores/transient/ui-store';

/** CommandPalette props */
export interface CommandPaletteProps {
  /** 是否打开（受控） */
  readonly open: boolean;
  /** 开关回调 */
  readonly onOpenChange: (open: boolean) => void;
}

/** 命令定义（注册表：新增命令只在此数组加一条） */
interface PaletteCommand {
  readonly id: string;
  /** 分组名 i18n key */
  readonly sectionKey: string;
  /** 标题 i18n key */
  readonly titleKey: string;
  readonly icon: typeof Settings2;
  /** 执行动作 */
  readonly run: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 收集面板内可聚焦元素（DOM 顺序即 Tab 顺序） */
function collectFocusable(overlay: HTMLElement): HTMLElement[] {
  return Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Tab/Shift+Tab 在面板内循环；焦点意外落到面板外时拉回第一个可聚焦元素 */
function trapTabKey(event: KeyboardEvent, overlay: HTMLElement): void {
  if (event.key !== 'Tab') {
    return;
  }
  const focusable = collectFocusable(overlay);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (!overlay.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

/** 给面板的兄弟节点加 inert/aria-hidden，返回恢复函数（保留节点原有值） */
function inertBackground(overlay: HTMLElement): () => void {
  const parent = overlay.parentElement;
  if (parent === null) {
    return () => {};
  }
  const inerted = Array.from(parent.children)
    .filter((el) => el !== overlay)
    .map((el) => ({
      el: el as HTMLElement,
      hadInert: el.hasAttribute('inert'),
      hadAriaHidden: el.getAttribute('aria-hidden'),
    }));
  for (const { el } of inerted) {
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  }
  return () => {
    for (const { el, hadInert, hadAriaHidden } of inerted) {
      if (!hadInert) {
        el.removeAttribute('inert');
      }
      if (hadAriaHidden === null) {
        el.removeAttribute('aria-hidden');
      } else {
        el.setAttribute('aria-hidden', hadAriaHidden);
      }
    }
  };
}

/**
 * 命令面板（Ctrl/Cmd+K 唤起）
 *
 * 模板版只含通用命令（设置 / 切换主题）。接入业务后把新命令追加到
 * COMMANDS；面板本身不需要改动（分组、过滤、键盘导航都由 cmdk 处理）。
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps): ReactElement | null {
  const { t } = useTranslation();
  const openSettings = useUiStore((s) => s.openSettings);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const theme = useSettingsStore((s) => s.theme);
  const [query, setQuery] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const overlay = overlayRef.current;
    if (overlay === null) {
      return;
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 先移焦再 inert 背景：避免对仍持有焦点的元素设置 aria-hidden（Chromium 会拒绝并告警）
    overlay.querySelector<HTMLInputElement>('.palette-input')?.focus();
    const restoreBackground = inertBackground(overlay);
    const handleKeyDown = (event: KeyboardEvent): void => trapTabKey(event, overlay);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreBackground();
      // 若关闭动作同时打开了另一个模态（如命令面板 → 设置），让新模态的焦点管理生效
      const active = document.activeElement;
      if (active === null || active === document.body || overlay.contains(active)) {
        previousFocus?.focus();
      }
    };
  }, [open]);

  const close = (): void => onOpenChange(false);

  const Commands: readonly PaletteCommand[] = [
    {
      id: 'settings',
      sectionKey: 'palette.sectionActions',
      titleKey: 'palette.openSettings',
      icon: Settings2,
      run: () => openSettings(),
    },
    {
      id: 'theme',
      sectionKey: 'palette.sectionActions',
      titleKey: theme === 'dark' ? 'palette.themeToLight' : 'palette.themeToDark',
      icon: theme === 'dark' ? Sun : Moon,
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
  ];

  const sections = Array.from(new Set(Commands.map((cmd) => cmd.sectionKey)));

  if (!open) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="palette-overlay show"
      role="dialog"
      aria-label={t('topbar.commandPalette')}
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          close();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      <Command className="palette" shouldFilter>
        <div className="palette-input-wrap">
          <Search className="size-4" strokeWidth={2} />
          <CommandInput
            className="palette-input"
            placeholder={t('palette.searchPlaceholder')}
            aria-label={t('palette.searchLabel')}
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <CommandList className="palette-results">
          <CommandEmpty className="palette-empty">{t('common.noResults')}</CommandEmpty>
          {sections.map((sectionKey) => (
            <CommandGroup key={sectionKey} heading={t(sectionKey)}>
              {Commands.filter((cmd) => cmd.sectionKey === sectionKey).map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem
                    key={cmd.id}
                    className="palette-item"
                    value={`${t(cmd.sectionKey)} ${t(cmd.titleKey)}`}
                    onSelect={() => {
                      cmd.run();
                      close();
                    }}
                  >
                    <span className="pi-icon">
                      <Icon className="size-3" strokeWidth={2} />
                    </span>
                    <span className="pi-main">
                      <span className="pi-title">{t(cmd.titleKey)}</span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
        <div className="palette-foot">
          <span>
            <kbd>↑↓</kbd> {t('palette.navigate')}
          </span>
          <span>
            <kbd>⏎</kbd> {t('palette.select')}
          </span>
          <span>
            <kbd>esc</kbd> {t('common.close')}
          </span>
        </div>
      </Command>
    </div>
  );
}
