import { FlaskConical } from 'lucide-react';
import type { ReactElement } from 'react';

import { useTranslation } from '@/i18n/use-translation';

/**
 * Beta 分区：实验功能入口
 *
 * 当前模板没有真实 feature flag，页面只呈现空态与风险提示；接入实验能力时
 * 在此渲染逐项开关，不把更新渠道混进来（更新统一在关于分区）。
 */
export function BetaSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex items-center gap-2">
        <FlaskConical className="text-muted-foreground size-4" strokeWidth={1.5} />
        <h3 className="text-foreground text-sm font-semibold">{t('settings.betaTitle')}</h3>
      </div>
      <p className="text-muted-foreground text-xs leading-[1.5] font-sans">
        {t('settings.betaHint')}
      </p>

      <div className="border-border bg-muted/20 rounded-md border p-3">
        <p className="text-foreground text-sm font-semibold">
          {t('settings.betaExperimentsTitle')}
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-[1.5]">
          {t('settings.betaExperimentsEmpty')}
        </p>
      </div>

      <p className="text-muted-foreground text-xs leading-[1.5] font-sans">
        {t('settings.betaRisk')}
      </p>
    </div>
  );
}
