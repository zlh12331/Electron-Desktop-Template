import { ZOOM_LEVELS } from '@code-agent/shared/renderer';
import { ZoomIn } from 'lucide-react';
import type { ReactElement } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/i18n/use-translation';
import { type Theme, useSettingsStore } from '@/stores/persistent/settings-store';
import { SettingRow } from '../settings-controls';

/** 外观分区：主题下拉 + 界面缩放 */
export function ZoomSection(): ReactElement {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const zoom = useSettingsStore((s) => s.appearance.zoom);
  const updateAppearance = useSettingsStore((s) => s.updateAppearance);

  return (
    <div className="flex flex-col gap-2">
      <SettingRow label={t('settings.themeTitle')} description={t('settings.themeDesc')}>
        <Select
          value={theme}
          onValueChange={(value) => {
            setTheme(value as Theme);
          }}
        >
          <SelectTrigger className="w-[130px]" aria-label={t('settings.themeTitle')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{t('settings.themeSystem')}</SelectItem>
            <SelectItem value="light">{t('settings.themeLight')}</SelectItem>
            <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <div className="mt-2 flex items-center gap-2">
        <ZoomIn className="text-muted-foreground size-3.5" strokeWidth={1.5} />
        <h3 className="text-foreground text-sm font-semibold">{t('settings.zoomTitle')}</h3>
      </div>
      <div className="bg-card mt-2 flex items-center gap-2.5 rounded-lg border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <Label htmlFor="zoom-level-select" className="text-foreground text-sm">
            {t('settings.zoomLabel')}
          </Label>
          <p className="text-muted-foreground mt-0.5 text-xs leading-[1.5]">
            {t('settings.zoomDesc')}
          </p>
        </div>
        <Select
          value={String(zoom)}
          onValueChange={(value) => {
            updateAppearance({ zoom: Number(value) });
          }}
        >
          <SelectTrigger
            id="zoom-level-select"
            className="w-[110px]"
            aria-label={t('settings.zoomLabel')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZOOM_LEVELS.map((level) => (
              <SelectItem key={level} value={String(level)}>
                {t('settings.zoomPercent', { percent: Math.round(level * 100) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
