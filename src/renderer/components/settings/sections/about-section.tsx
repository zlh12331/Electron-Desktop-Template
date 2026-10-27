import { PRODUCT_NAME } from '@code-agent/shared/renderer';
import { Clipboard, Loader2, Rocket } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAppInfo } from '@/hooks/use-app-info';
import { useInstallUpdate } from '@/hooks/use-install-update';
import { useUpdate } from '@/hooks/use-update';
import { useTranslation } from '@/i18n/use-translation';
import { reportError } from '@/lib/error-report';
import { formatDateTime } from '@/lib/format-intl';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/persistent/settings-store';
import { SectionTitle, ToggleRow } from '../settings-controls';
import {
  copyToClipboard,
  DiagnosticsCard,
  exportDiagnostics,
  formatBuildTime,
  openDataDirAction,
} from './about/diagnostics-card';
import { UpdateBlock } from './about/update-block';

/** 无边框信息行（label 左 + 值右，纸感极简布局；替代 SettingRow 的卡片+边框形态） */
function InfoRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-foreground shrink-0 text-sm">{label}</span>
      <div className="min-w-0 shrink text-xs">{children}</div>
    </div>
  );
}

/**
 * 渠道徽章（stable / beta / dev 三色）
 *
 * 表驱动：此前内联的三段 `channel === 'x' && 'class'` 条件类曾是 AboutSection
 * 复杂度的一部分；映射表让「渠道 → 配色」成为数据而非分支。
 * 未收录渠道回退中性色（新增渠道不会掉样式）。
 */
const CHANNEL_CLASSES: Readonly<Record<string, string>> = {
  stable: 'bg-accent/10 text-accent-text',
  beta: 'bg-accent-2/10 text-accent-text',
  dev: 'bg-muted text-muted-foreground',
};

function ChannelBadge({ channel }: { readonly channel: string }): ReactElement {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 font-mono text-2xs',
        CHANNEL_CLASSES[channel] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {channel}
    </span>
  );
}

/**
 * 关于 pane（品牌 Hero + 分组卡片）
 *
 * 更新状态区、诊断卡与格式化逻辑分别在 about/ 下；本文件只负责组装。
 */
export function AboutSection(): ReactElement {
  const { t, i18n } = useTranslation();
  const info = useAppInfo((error: unknown) => {
    reportError(error, { tags: { scope: 'about-section.getInfo' } });
    toast.error(t('settings.aboutLoadFailed'));
  });
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { state: updateState, check, cancel, lastCheckAt } = useUpdate();
  const installUpdate = useInstallUpdate();
  const autoCheck = useSettingsStore((s) => s.update.autoCheck);
  const allowPrerelease = useSettingsStore((s) => s.update.allowPrerelease);
  const skippedVersion = useSettingsStore((s) => s.update.skippedVersion);
  const setUpdate = useSettingsStore((s) => s.setUpdate);

  /**
   * 切换自动检查开关
   *
   * 开启时立刻补检一次（复用 update:check，手动语义 = 失败会提示），
   * 让用户当场看到效果；关闭只影响后续启动的自动调度（主进程下次启动读取）。
   */
  const handleAutoCheckChange = (checked: boolean): void => {
    setUpdate({ autoCheck: checked });
    if (checked) {
      void check();
    }
  };

  /**
   * 切换「接收预发布更新」开关
   *
   * 主进程在每次检查入口重读本设置（update-service check()），开启后立即补检
   * 一次即可收到 beta；关闭回退为只收正式版。装了 beta 版（版本号含 `-`）时
   * 恒收预发布，本开关不影响（update-service 的版本判定基线保留）。
   */
  const handleAllowPrereleaseChange = (checked: boolean): void => {
    setUpdate({ allowPrerelease: checked });
    if (checked) {
      void check();
    }
  };

  /** 跳过当前版本：记录版本号，顶栏徽标与 toast 对该版本静默（不阻断下载/安装） */
  const handleSkipVersion = (): void => {
    const version = updateState?.version;
    if (version !== undefined && version !== '') {
      setUpdate({ skippedVersion: version });
    }
  };

  /** 复制文本到剪贴板（含在途态复位） */
  const copyText = async (text: string): Promise<void> => {
    setCopying(true);
    await copyToClipboard(text, t);
    setCopying(false);
  };

  /** 导出诊断包（含在途态复位） */
  const handleExportDiagnostics = async (): Promise<void> => {
    setExporting(true);
    await exportDiagnostics(t);
    setExporting(false);
  };

  const channel = info?.channel;

  return (
    <div className="flex flex-col gap-3">
      <Card className="relative overflow-hidden px-4 py-8">
        <div className="relative flex flex-col items-center text-center">
          <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-xl">
            <Rocket className="size-7" strokeWidth={1.25} />
          </div>
          <div className="text-foreground mt-3.5 text-lg leading-tight font-semibold tracking-wide">
            {PRODUCT_NAME}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">{t('settings.aboutTagline')}</div>
          <div className="mt-3.5 flex items-center gap-1.5">
            <span className="bg-muted text-foreground inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs">
              {info === null ? '…' : `v${info.version}`}
            </span>
            {channel !== undefined && <ChannelBadge channel={channel} />}
          </div>
          <div className="mt-4 flex w-full flex-col items-center gap-2">
            <UpdateBlock
              state={updateState}
              onCheck={() => void check()}
              onCancel={cancel}
              onInstall={() => void installUpdate()}
              onSkip={handleSkipVersion}
              onOpenDataDir={openDataDirAction}
            />
            {skippedVersion !== null && skippedVersion === updateState?.version && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground text-xs">
                  {t('settings.aboutSkipped', { version: skippedVersion })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUpdate({ skippedVersion: null })}
                >
                  {t('settings.aboutUnskip')}
                </Button>
              </div>
            )}
            {lastCheckAt !== null && (
              <span className="text-muted-foreground text-xs">
                {t('settings.aboutLastCheck', {
                  time: formatDateTime(lastCheckAt, i18n.language),
                })}
              </span>
            )}
          </div>
        </div>
      </Card>

      <SectionTitle>{t('settings.aboutUpdatesTitle')}</SectionTitle>
      <ToggleRow
        name={t('settings.aboutAutoCheck')}
        description={t('settings.aboutAutoCheckDesc')}
        checked={autoCheck}
        onChange={handleAutoCheckChange}
      />
      <ToggleRow
        name={t('settings.aboutAllowPrerelease')}
        description={t('settings.aboutAllowPrereleaseDesc')}
        checked={allowPrerelease}
        onChange={handleAllowPrereleaseChange}
      />

      <SectionTitle>{t('settings.aboutBuildTitle')}</SectionTitle>
      <Card className="flex flex-col">
        <InfoRow label={t('settings.aboutBuildChannel')}>
          <span className="text-muted-foreground font-mono">{channel ?? '-'}</span>
        </InfoRow>
        <InfoRow label={t('settings.aboutBuildTime')}>
          <span className="text-muted-foreground font-mono">
            {info?.buildTime === undefined ? '-' : formatBuildTime(info.buildTime, i18n.language)}
          </span>
        </InfoRow>
        <InfoRow label={t('settings.aboutBuildCommit')}>
          {info?.commitSha !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-auto gap-1 rounded px-0 font-mono"
              aria-label={t('settings.aboutCopy')}
              title={t('settings.aboutCopy')}
              onClick={() => void copyText(info.commitSha ?? '')}
            >
              {info.commitSha}
              {copying ? (
                <Loader2 className="size-3 animate-spin" strokeWidth={1.5} />
              ) : (
                <Clipboard className="size-3" strokeWidth={1.5} />
              )}
            </Button>
          ) : (
            <span className="text-muted-foreground font-mono">-</span>
          )}
        </InfoRow>
      </Card>

      <SectionTitle>{t('settings.aboutRuntime')}</SectionTitle>
      <Card className="flex flex-col">
        <InfoRow label="Electron">
          <span className="text-muted-foreground font-mono">{info?.electron ?? '…'}</span>
        </InfoRow>
        <InfoRow label="Node.js">
          <span className="text-muted-foreground font-mono">{info?.node ?? '…'}</span>
        </InfoRow>
        <InfoRow label="Chromium">
          <span className="text-muted-foreground font-mono">{info?.chrome ?? '…'}</span>
        </InfoRow>
        <InfoRow label={t('settings.aboutPlatform')}>
          <span className="text-muted-foreground font-mono">
            {info === null ? '…' : `${info.platform} ${info.arch}`}
          </span>
        </InfoRow>
        <InfoRow label={t('settings.aboutUserData')}>
          <span
            className="text-muted-foreground inline-block max-w-[220px] truncate align-bottom font-mono"
            title={info?.userDataPath}
          >
            {info?.userDataPath ?? '…'}
          </span>
        </InfoRow>
      </Card>

      <SectionTitle>{t('settings.aboutDiagnosticsTitle')}</SectionTitle>
      <DiagnosticsCard
        info={info}
        locale={i18n.language}
        copying={copying}
        exporting={exporting}
        onCopy={(text) => void copyText(text)}
        onExport={() => void handleExportDiagnostics()}
      />

      <SectionTitle>{t('settings.aboutLegalTitle')}</SectionTitle>
      <Card className="flex flex-col">
        <InfoRow label="License">
          <span className="text-muted-foreground font-mono">{t('settings.aboutLicenseValue')}</span>
        </InfoRow>
      </Card>
      <p className="text-muted-foreground px-1.5 text-2xs">{t('settings.aboutThanks')}</p>
    </div>
  );
}
