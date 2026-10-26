import { ArrowLeft, Settings as SettingsIcon } from 'lucide-react';
import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SectionErrorBoundary } from '@/components/common/SectionErrorBoundary';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useTranslation } from '@/i18n/use-translation';
import { DEFAULT_SETTINGS_SECTION } from '@/lib/settings-sections';
import { resolveNextTabIndex } from '@/lib/settings-tabs';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/transient/ui-store';
import { SETTINGS_SECTION_MAP, SETTINGS_SECTIONS } from './sections/registry';

/** SettingsDialog props */
export interface SettingsDialogProps {
  /** 是否打开（受控） */
  readonly open: boolean;
  /** 开关回调 */
  readonly onOpenChange: (open: boolean) => void;
}

/** 设置导航的 roving focus：方向键移动焦点，Enter/Space 由原生 button 激活 */
function handleTabNavigation(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-nav-item="true"]'),
  );
  if (buttons.length === 0) {
    return;
  }
  const activeEl = document.activeElement as HTMLElement | null;
  // biome-ignore lint/complexity/useIndexOf: activeEl 为 HTMLElement，indexOf 需窄化断言，findIndex 类型安全
  const currentIndex = buttons.findIndex((btn) => btn === activeEl);
  const nextIndex = resolveNextTabIndex(event.key, currentIndex, buttons.length);
  buttons[nextIndex]?.focus();
}

/**
 * 设置全屏页（组装层）
 *
 * 分区全部来自 sections/registry（导航分组 + 组件同源），本文件只负责壳与键盘导航。
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): ReactElement {
  const { t } = useTranslation();
  const activeSection = useUiStore((s) => s.settingsSection ?? DEFAULT_SETTINGS_SECTION);
  const setActiveSection = useUiStore((s) => s.setSettingsSection);
  const ActiveComponent = SETTINGS_SECTION_MAP.get(activeSection)?.component;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        withOverlay={false}
        className="bg-card flex h-full w-full max-w-none flex-col gap-0 border-l p-0"
      >
        <SheetTitle className="sr-only">{t('settings.title')}</SheetTitle>
        <SheetDescription className="sr-only">{t('settings.desc')}</SheetDescription>

        <div className="bg-muted/50 flex shrink-0 items-center gap-2.5 border-b px-[18px] py-3.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground h-9 gap-1.5 rounded-lg px-3 text-sm"
            aria-label={t('settings.back')}
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
            {t('settings.back')}
          </Button>
          <SettingsIcon className="text-primary size-4" strokeWidth={1.5} />
          <span className="text-foreground text-sm font-semibold">{t('settings.title')}</span>
          <span className="text-muted-foreground font-mono text-xs">{t('settings.desc')}</span>
          <div className="app-region-drag ml-auto h-full w-[140px] shrink-0" aria-hidden="true" />
        </div>

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[160px_1fr] overflow-hidden">
          <div
            className="bg-muted/30 overflow-y-auto overflow-x-hidden border-r px-2 py-3"
            role="tablist"
            aria-label={t('settings.sectionsAriaLabel')}
            aria-orientation="vertical"
            onKeyDown={handleTabNavigation}
          >
            {SETTINGS_SECTIONS.map((group) => (
              <div key={group.labelKey} className="mb-1">
                <div className="text-muted-foreground px-3 pt-2 pb-1 text-2xs font-semibold tracking-[0.08em] uppercase">
                  {t(group.labelKey)}
                </div>
                {group.items.map((item) => {
                  const isActive = activeSection === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      id={`settings-tab-${item.id}`}
                      aria-controls="settings-panel"
                      tabIndex={isActive ? 0 : -1}
                      data-nav-item="true"
                      onClick={() => setActiveSection(item.id)}
                      className={cn(
                        'text-muted-foreground hover:bg-muted hover:text-foreground mb-0.5 flex w-full items-center gap-[9px] rounded-[calc(var(--radius)-1px)] border-l-2 border-l-transparent px-2.5 py-2 text-left text-sm transition-colors',
                        isActive &&
                          'bg-card text-foreground border-l-[color:var(--accent)] font-medium',
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeSection}`}
            className="overflow-y-auto overflow-x-hidden px-5 py-[18px]"
          >
            <SectionErrorBoundary name={`settings:${activeSection}`} resetKeys={[activeSection]}>
              {ActiveComponent === undefined ? null : <ActiveComponent drawerOpen={open} />}
            </SectionErrorBoundary>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
