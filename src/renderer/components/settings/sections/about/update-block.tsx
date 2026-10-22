import type { UpdateStatusPayload } from '@code-agent/shared/renderer';
import { FolderOpen, Loader2, PackageCheck, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useTranslation } from '@/i18n/use-translation';
import { formatBytes, formatRemainingClock } from '@/lib/format-bytes';

import { ReleaseNotes } from './release-notes';

/** i18n 文案函数类型（react-i18next 未导出 TFunction，由 hook 推导） */
type TranslateFn = ReturnType<typeof useTranslation>['t'];

/** 更新区 props */
interface UpdateBlockProps {
  readonly state: UpdateStatusPayload | null;
  readonly onCheck: () => void;
  readonly onCancel: () => void;
  readonly onInstall: () => void;
  readonly onSkip: () => void;
  readonly onOpenDataDir: () => void;
}

/**
 * 更新错误文案（主进程已分类 → 本地化文案）
 *
 * unknown / 未分类时保留原始英文 message：这类错误需要用户把技术细节带到
 * issue，统一套一句"未知错误"反而丢掉排查线索（原始信息同时已进 main.log）。
 */
function describeUpdateError(t: TranslateFn, state: UpdateStatusPayload | null): string {
  switch (state?.errorKind) {
    case 'network':
      return t('update.errNetwork');
    case 'rate-limited':
      return t('update.errRateLimited');
    case 'checksum':
      return t('update.errChecksum');
    case 'disk':
      return t('update.errDisk');
    default:
      return state?.message !== undefined && state.message !== ''
        ? state.message
        : t('settings.aboutUpdateNotAvailable');
  }
}

/** 下载中区块 props */
interface DownloadingBlockProps {
  readonly state: UpdateStatusPayload | null;
  readonly onCancel: () => void;
}

/**
 * 下载中区块（进度条 + 字节/速率/剩余 + 取消）
 *
 * 进度每秒推送一次（electron-updater 内建节流）；差分下载时 total 是本次需下载的
 * 字节数（差分包大小），不是完整安装包体积。ETA 无法估算时用占位符，不编造数字。
 */
function DownloadingBlock({ state, onCancel }: DownloadingBlockProps): ReactElement {
  const { t } = useTranslation();
  const percent = state?.progress ?? 0;
  const title = t('update.downloadingTitle', { version: state?.version ?? '' });
  const transferred = state?.transferred;
  const total = state?.total;
  const rate = state?.bytesPerSecond;
  const detail =
    transferred !== undefined && total !== undefined && rate !== undefined
      ? t('update.progressDetail', {
          done: formatBytes(transferred),
          total: formatBytes(total),
          speed: formatBytes(rate),
          eta: formatRemainingClock(transferred, total, rate) ?? t('update.etaUnknown'),
        })
      : `${Math.round(percent)}%`;
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-foreground inline-flex items-center gap-1 text-xs">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
          {title}
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('update.cancel')}
        </Button>
      </div>
      <Progress value={percent} label={title} />
      <span className="text-muted-foreground text-xs leading-[1.5]">
        {percent < 1 ? t('update.preparing') : detail}
      </span>
    </div>
  );
}

/**
 * 更新状态区（按 UpdatePhase 分派）
 *
 * 抽离动机（2026-09 审计）：此前是内联在 AboutSection 里的 **7 段嵌套三元链**
 * （undefined / checking+downloading / not-available / available / downloaded /
 * error），使 AboutSection 认知复杂度达 43（阈值 15）。改为早返回的分派组件后，
 * 每个阶段是独立直线分支，主组件只负责组装。
 */
export function UpdateBlock({
  state,
  onCheck,
  onCancel,
  onInstall,
  onSkip,
  onOpenDataDir,
}: UpdateBlockProps): ReactElement {
  const { t } = useTranslation();
  const phase = state?.phase;

  if (phase === undefined) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCheck}>
          <RefreshCw className="size-3.5" strokeWidth={1.5} />
          {t('settings.aboutCheckUpdate')}
        </Button>
      </div>
    );
  }

  if (phase === 'checking') {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled>
          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
          {t('settings.aboutChecking')}
        </Button>
      </div>
    );
  }

  if (phase === 'downloading') {
    return <DownloadingBlock state={state} onCancel={onCancel} />;
  }

  if (phase === 'not-available') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-success-text inline-flex items-center gap-1 text-xs">
          <PackageCheck className="size-3.5" strokeWidth={1.5} />
          {t('settings.aboutUpToDate')}
        </span>
      </div>
    );
  }

  if (phase === 'available') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-accent-text inline-flex items-center gap-1 text-xs">
          <RefreshCw className="size-3.5" strokeWidth={1.5} />
          {t('settings.aboutUpdateAvailable')}
          {' · '}
          {t('settings.aboutUpdateVersion', { version: state?.version ?? '' })}
        </span>
        <Button variant="ghost" size="sm" onClick={onSkip}>
          {t('update.skipVersion')}
        </Button>
      </div>
    );
  }

  if (phase === 'downloaded') {
    const notes = state?.releaseNotes;
    return (
      <div className="flex w-full flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-accent-text inline-flex items-center gap-1 text-xs">
            <PackageCheck className="size-3.5" strokeWidth={1.5} />
            {t('settings.aboutUpdateReady')}
          </span>
          <Button size="sm" variant="outline" onClick={onInstall}>
            {t('settings.aboutInstallRestart')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t('update.skipVersion')}
          </Button>
        </div>
        {notes !== undefined && notes !== '' && <ReleaseNotes notes={notes} />}
      </div>
    );
  }

  if (phase === 'cancelled') {
    return (
      <div className="flex w-full flex-col items-start gap-2">
        <span className="text-muted-foreground text-xs leading-[1.5]">
          {t('settings.aboutCancelled')}
        </span>
        <Button variant="outline" size="sm" onClick={onCheck}>
          <RefreshCw className="size-3.5" strokeWidth={1.5} />
          {t('settings.aboutCheckUpdate')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <span className="text-error-text text-xs leading-[1.5]">{describeUpdateError(t, state)}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCheck}>
          <RefreshCw className="size-3.5" strokeWidth={1.5} />
          {t('settings.aboutCheckUpdate')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenDataDir}>
          <FolderOpen className="size-3.5" strokeWidth={1.5} />
          {t('settings.aboutOpenDataDir')}
        </Button>
      </div>
    </div>
  );
}
