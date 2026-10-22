import { PRODUCT_NAME } from '@code-agent/shared/renderer';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router';

import { AsyncBoundary } from '@/components/common/AsyncBoundary';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAppInfo } from '@/hooks/use-app-info';
import { useAsyncView } from '@/hooks/use-async-view';
import { useCopy } from '@/hooks/use-copy';
import { useSystemStatusQuery } from '@/hooks/use-system';
import { useTranslation } from '@/i18n/use-translation';
import { ROUTES } from '@/lib/constants';

/**
 * 关于页：示例业务路由
 *
 * 用途是证明「新增一个页面」在模板里需要改什么：
 * 1. 在 lib/constants.ts 的 ROUTES 加路径常量；
 * 2. 在 router.tsx 加一条 children 路由（lazy 导入）；
 * 3. 本文件即页面本身。
 *
 * 同时演示两件底座能力：`AsyncBoundary`（异步视图的五态渲染）与 `useCopy`
 * （统一复制反馈）。接入业务后可删除或替换。
 */
export function AboutPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const info = useAppInfo();
  const { copied, copy } = useCopy();
  const statusQuery = useSystemStatusQuery();
  const view = useAsyncView(statusQuery, { isEmpty: () => false });

  const diagnostics = [
    `${PRODUCT_NAME} ${info?.version ?? '-'}`,
    `Electron  : ${info?.electron ?? '-'}`,
    `Node.js   : ${info?.node ?? '-'}`,
    `Chromium  : ${info?.chrome ?? '-'}`,
    `Platform  : ${info?.platform ?? '-'} ${info?.arch ?? '-'}`,
    `User data : ${info?.userDataPath ?? '-'}`,
  ].join('\n');

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-xl">
        <Button variant="ghost" size="sm" className="mb-6" onClick={() => navigate(ROUTES.home)}>
          <ArrowLeft className="size-3.5" />
          {t('common.back')}
        </Button>

        <Card className="gap-3 px-6 py-6">
          <h2 className="text-foreground text-lg font-semibold">{t('about.title')}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('about.body', { product: PRODUCT_NAME })}
          </p>

          <div className="mt-2 flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium">{t('about.runtime')}</div>
            <AsyncBoundary
              view={view}
              skeleton={<div className="bg-muted h-16 animate-pulse rounded-md" />}
              empty={<div className="text-muted-foreground text-xs">{t('about.noRuntime')}</div>}
            >
              {(status) => (
                <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
                  <dt>Electron</dt>
                  <dd>{status.electronVersion}</dd>
                  <dt>Node</dt>
                  <dd>{status.nodeVersion}</dd>
                  <dt>Uptime</dt>
                  <dd>{Math.floor(status.uptimeSeconds)}s</dd>
                  <dt>RSS</dt>
                  <dd>{Math.round(status.memory.rss / 1024 / 1024)}MB</dd>
                </dl>
              )}
            </AsyncBoundary>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void copy(diagnostics)}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? t('about.copied') : t('about.copyDiagnostics')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
