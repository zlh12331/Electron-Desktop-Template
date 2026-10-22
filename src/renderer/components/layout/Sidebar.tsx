import { Info, Settings2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/use-translation';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/transient/ui-store';

/**
 * 左侧栏：导航骨架
 *
 * 模板版只保留「主页 / 关于 / 设置」三个入口，说明侧栏的写法：
 * 导航项由本文件的数据驱动（不是硬编码 JSX），接入业务时把 NAV_ITEMS 换成真实入口即可。
 * 宽度受 --sidebar-w 令牌控制，拖拽逻辑在 AppShell。
 */
interface NavItem {
  readonly id: string;
  readonly labelKey: string;
  readonly icon: typeof Info;
  /** 目标路由（与 openSettings 二选一） */
  readonly path?: string;
  /** 点击打开设置分区 */
  readonly settingsSection?: 'general';
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'about', labelKey: 'sidebar.nav.about', icon: Info, path: ROUTES.about },
  { id: 'settings', labelKey: 'sidebar.nav.settings', icon: Settings2, settingsSection: 'general' },
];

/** 左侧导航栏 */
export function Sidebar(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <nav
      className="sidebar-bg flex h-full min-h-0 flex-col border-r"
      aria-label={t('sidebar.ariaLabel')}
    >
      <div className="flex-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.path !== undefined && location.pathname === item.path;
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              onClick={() => {
                if (item.path !== undefined) {
                  navigate(item.path);
                } else if (item.settingsSection !== undefined) {
                  openSettings(item.settingsSection);
                }
              }}
              className={cn(
                'mb-0.5 w-full justify-start gap-2 px-2.5 text-sm font-normal',
                active && 'bg-muted text-foreground font-medium',
              )}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">{t(item.labelKey)}</span>
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
