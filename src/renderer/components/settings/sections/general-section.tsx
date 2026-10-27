import type { LoginItemSettingsRes } from '@code-agent/shared/renderer';
import { type ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SUPPORTED_LANGUAGES } from '@/i18n/config';
import { useTranslation } from '@/i18n/use-translation';
import { LANGUAGE_ENDONYMS } from '@/lib/language-endonyms';
import {
  getLoginItemSettings,
  setLoginItemSettings,
  subscribeLoginItemChanged,
} from '@/lib/settings-ops';
import type { AppLanguage } from '@/stores/persistent/settings-store';
import { useSettingsStore } from '@/stores/persistent/settings-store';
import { SegControl, SettingRow, ToggleRow } from '../settings-controls';
import { TelemetrySection } from './telemetry-section';

/** 语言切换行（真实 i18n：设置值 system 在 store 内解析为当前 OS 语言） */
function LanguageRow(): ReactElement {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  return (
    <SettingRow label={t('settings.language')} description={t('settings.languageDesc')}>
      <Select
        value={language}
        onValueChange={(value) => {
          setLanguage(value as AppLanguage);
        }}
      >
        <SelectTrigger className="w-[150px]" aria-label={t('settings.language')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">{t('settings.languageSystem')}</SelectItem>
          {SUPPORTED_LANGUAGES.map((code) => (
            <SelectItem key={code} value={code}>
              {LANGUAGE_ENDONYMS[code]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/** 通用 pane：语言 + 窗口行为 + 遥测；其余能力由独立导航分区承载 */
export function GeneralSection(): ReactElement {
  const { t } = useTranslation();
  const closeAction = useSettingsStore((s) => s.window.closeAction);
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
        <div className="mt-2">
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
