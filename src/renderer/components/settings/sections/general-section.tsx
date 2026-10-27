import type { LoginItemSettingsRes } from '@code-agent/shared/renderer';
import { Check, Languages } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SUPPORTED_LANGUAGES } from '@/i18n/config';
import { useTranslation } from '@/i18n/use-translation';
import { LANGUAGE_ENDONYMS } from '@/lib/language-endonyms';
import {
  getLoginItemSettings,
  setLoginItemSettings,
  subscribeLoginItemChanged,
} from '@/lib/settings-ops';
import { cn } from '@/lib/utils';
import type { AppLanguage } from '@/stores/persistent/settings-store';
import { useSettingsStore } from '@/stores/persistent/settings-store';
import { SegControl, SettingRow, ToggleRow } from '../settings-controls';
import { TelemetrySection } from './telemetry-section';

/** 语言切换行（真实 i18n：设置值 system 在 store 内解析为当前 OS 语言） */
function LanguageRow(): ReactElement {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const options: readonly { readonly value: AppLanguage; readonly label: string }[] = [
    { value: 'system', label: t('settings.languageSystem') },
    ...SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_ENDONYMS[code] })),
  ];

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Languages className="text-muted-foreground size-3.5" strokeWidth={1.5} />
        <span className="text-foreground text-sm">{t('settings.language')}</span>
      </div>
      <div className="flex items-center gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto gap-1 rounded px-2 py-1 text-xs',
              language === option.value
                ? 'bg-muted text-foreground border-border'
                : 'text-muted-foreground border-transparent',
            )}
            onClick={() => setLanguage(option.value)}
          >
            {option.label}
            {language === option.value && <Check className="size-3" strokeWidth={2} />}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** 通用 pane：语言 + 窗口行为 + 遥测；其余能力由独立导航分区承载 */
export function GeneralSection(): ReactElement {
  const { t } = useTranslation();
  const closeAction = useSettingsStore((s) => s.window.closeAction);
  const startMinimized = useSettingsStore((s) => s.window.startMinimized);
  const setWindow = useSettingsStore((s) => s.setWindow);
  const [autostart, setAutostart] = useState<LoginItemSettingsRes | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setAutostart(await getLoginItemSettings());
      } catch {
        setAutostart(null);
      }
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeLoginItemChanged((payload) => {
      setAutostart(payload);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleToggleAutostart = async (checked: boolean): Promise<void> => {
    try {
      const res = await setLoginItemSettings({ openAtLogin: checked });
      if (res === null) return;
      setAutostart(res);
    } catch {
      toast.error(t('settings.autostartFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div>
        <h3 className="text-foreground text-sm font-semibold">{t('settings.generalTitle')}</h3>
        <div className="border-border bg-muted/20 mt-2 rounded-md border p-3">
          <LanguageRow />
        </div>
      </div>

      <div>
        <h3 className="text-foreground text-sm font-semibold">{t('settings.windowTitle')}</h3>
        <div className="mt-2 flex flex-col gap-2">
          <SettingRow
            label={t('settings.closeActionLabel')}
            description={t('settings.closeActionDesc')}
          >
            <SegControl
              value={closeAction}
              options={[
                { value: 'minimize', label: t('settings.closeActionMinimize') },
                { value: 'quit', label: t('settings.closeActionQuit') },
              ]}
              onChange={(value) => setWindow({ closeAction: value as 'quit' | 'minimize' })}
            />
          </SettingRow>
          <ToggleRow
            name={t('settings.autostartLabel')}
            description={
              autostart?.requiresApproval === true
                ? t('settings.autostartApprovalDesc')
                : autostart?.supported === false
                  ? t('settings.autostartUnsupportedDesc')
                  : t('settings.autostartDesc')
            }
            checked={autostart?.openAtLogin ?? false}
            disabled={autostart?.supported === false}
            onChange={(checked) => void handleToggleAutostart(checked)}
          />
          <ToggleRow
            name={t('settings.startMinimizedLabel')}
            description={t('settings.startMinimizedDesc')}
            checked={startMinimized}
            onChange={(checked) => setWindow({ startMinimized: checked })}
          />
        </div>
      </div>

      <div>
        <h3 className="text-foreground text-sm font-semibold">{t('settings.telemetryTitle')}</h3>
        <div className="mt-2">
          <TelemetrySection />
        </div>
      </div>
    </div>
  );
}
