import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from 'cmdk';
import { Info, Moon, Search, Settings2, Sun } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useTranslation } from '@/i18n/use-translation';
import { ROUTES } from '@/lib/constants';
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
  readonly icon: typeof Info;
  /** 执行动作 */
  readonly run: () => void;
}

/**
 * 命令面板（Ctrl/Cmd+K 唤起）
 *
 * 模板版只含通用命令（设置 / 关于 / 切换主题）。接入业务后把新命令追加到
 * COMMANDS；面板本身不需要改动（分组、过滤、键盘导航都由 cmdk 处理）。
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps): ReactElement | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openSettings = useUiStore((s) => s.openSettings);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const theme = useSettingsStore((s) => s.theme);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
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
      id: 'about',
      sectionKey: 'palette.sectionNavigation',
      titleKey: 'palette.openAbout',
      icon: Info,
      run: () => navigate(ROUTES.about),
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
            autoFocus
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
