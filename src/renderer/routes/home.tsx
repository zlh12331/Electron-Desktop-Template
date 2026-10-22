import { PRODUCT_NAME } from '@code-agent/shared/renderer';
import { ArrowRight, Layers, Package, Settings2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTranslation } from '@/i18n/use-translation';
import { ROUTES } from '@/lib/constants';
import { useUiStore } from '@/stores/transient/ui-store';

/** 能力卡片（模板自述：告诉使用者这套底座开箱可用什么） */
interface Capability {
  readonly icon: typeof Layers;
  readonly titleKey: string;
  readonly descKey: string;
}

const CAPABILITIES: readonly Capability[] = [
  { icon: Layers, titleKey: 'welcome.card.ipc.title', descKey: 'welcome.card.ipc.desc' },
  {
    icon: Settings2,
    titleKey: 'welcome.card.settings.title',
    descKey: 'welcome.card.settings.desc',
  },
  { icon: Package, titleKey: 'welcome.card.release.title', descKey: 'welcome.card.release.desc' },
];

/**
 * 欢迎页：模板落地页
 *
 * 模板版不承载业务内容——这里是接入方替换的第一个页面。保留的三张卡片用于
 * 说明底座已具备的能力（IPC 契约体系 / 设置持久化 / 三平台打包与更新），
 * 接入业务后可整体删除。
 */
export function HomePage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="text-muted-foreground mb-2 font-mono text-xs tracking-widest uppercase">
            {t('welcome.eyebrow')}
          </div>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            {t('welcome.tagline')}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, titleKey, descKey }) => (
            <Card key={titleKey} className="gap-2 px-4 py-4">
              <Icon className="text-primary size-4" strokeWidth={1.5} />
              <div className="text-foreground text-sm font-medium">{t(titleKey)}</div>
              <div className="text-muted-foreground text-xs leading-relaxed">{t(descKey)}</div>
            </Card>
          ))}
        </div>

        <div className="mt-8 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openSettings()}>
            <Settings2 className="size-3.5" />
            {t('welcome.action.settings')}
          </Button>
          <Button size="sm" onClick={() => navigate(ROUTES.about)}>
            {t('welcome.action.about')}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
