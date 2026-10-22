import { Bell } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from '@/i18n/use-translation';
import { useSettingsStore } from '@/stores/persistent/settings-store';
import { ToggleRow } from '../settings-controls';

/** 系统通知区块（唯一消费方：主进程 tray.ts 的最小化引导提示） */
export function NotificationSection(): ReactElement {
  const { t } = useTranslation();
  const notification = useSettingsStore((s) => s.notification);
  const updateNotification = useSettingsStore((s) => s.updateNotification);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Bell className="text-muted-foreground size-3.5" strokeWidth={1.5} />
        <h3 className="text-foreground text-sm font-semibold">{t('settings.notificationTitle')}</h3>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <ToggleRow
          name={t('settings.notificationLabel')}
          description={t('settings.notificationDesc')}
          checked={notification.enabled}
          onChange={(checked) => updateNotification({ enabled: checked })}
        />
      </div>
    </div>
  );
}
