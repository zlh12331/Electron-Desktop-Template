import { NotebookPen, Settings2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/use-translation';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/transient/ui-store';

/**
 * 左侧栏：顶部业务导航 + 底部固定设置入口
 *
 * 导航项由本文件的数据驱动（不是硬编码 JSX），接入业务时把 NAV_ITEMS 换成真实入口即可。
 * 设置固定在左下角，避免与业务导航混排；宽度受 --sidebar-w 令牌控制，拖拽逻辑在 AppShell。
 */
interface NavItem {
  readonly id: string;
  readonly labelKey: string;
  readonly icon: typeof NotebookPen;
  /** 目标路由 */
  readonly path: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  // notes-example:start
  { id: 'notes', labelKey: 'sidebar.nav.notes', icon: NotebookPen, path: ROUTES.notes },
  // notes-example:end
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
          const active =
            location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              onClick={() => navigate(item.path)}
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

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openSettings('general')}
          className="w-full justify-start gap-2 px-2.5 text-sm font-normal"
        >
          <Settings2 className="size-3.5 shrink-0" strokeWidth={1.5} />
          <span className="truncate">{t('sidebar.nav.settings')}</span>
        </Button>
      </div>
    </nav>
  );
}
