import type { AppInfoRes } from '@code-agent/shared/renderer';
import { PRODUCT_NAME } from '@code-agent/shared/renderer';
import { Clipboard, FolderOpen, Loader2, PackageCheck } from 'lucide-react';
import type { ReactElement } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTranslation } from '@/i18n/use-translation';
import { openDataDir } from '@/lib/app-actions';
import { formatDateTime } from '@/lib/format-intl';
import { hasIpcBridge } from '@/lib/ipc';
import { exportDiagnostics as exportDiagnosticsOp } from '@/lib/settings-ops';

/** i18n 文案函数类型（react-i18next 未导出 TFunction，由 hook 推导） */
type TranslateFn = ReturnType<typeof useTranslation>['t'];

/** 格式化构建时间为本地可读时间（跟随 locale；解析失败返回原文） */
export function formatBuildTime(iso: string, locale: string): string {
  return formatDateTime(iso, locale, iso);
}

/**
 * 拼接诊断信息为纯文本（VS Code About「复制」同款，报 bug/提 issue 时整段粘贴）
 * 只包含 app:getInfo 已提供的真实字段，不虚构任何数据
 */
function formatDiagnostics(info: AppInfoRes, locale: string): string {
  return [
    `${PRODUCT_NAME} ${info.version}`,
    `Channel   : ${info.channel ?? '-'}`,
    `Electron  : ${info.electron}`,
    `Node.js   : ${info.node}`,
    `Chromium  : ${info.chrome}`,
    `Platform  : ${info.platform} ${info.arch}`,
    `Build time: ${info.buildTime === undefined ? '-' : formatBuildTime(info.buildTime, locale)}`,
    `Commit    : ${info.commitSha ?? '-'}`,
    `User data : ${info.userDataPath}`,
  ].join('\n');
}

/** 复制文本到剪贴板（无剪贴板 API 时静默；失败给反馈而非"点了没反应"） */
export async function copyToClipboard(text: string, t: TranslateFn): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('settings.aboutCopied'));
  } catch {
    toast.error(t('common.copyFailed'));
  }
}

/** 导出诊断包（构建/日志/系统信息，上传给支持定位问题的标准途径） */
export async function exportDiagnostics(t: TranslateFn): Promise<void> {
  try {
    const res = await exportDiagnosticsOp();
    if (res === null) return;
    if (res.saved && res.path !== undefined) {
      toast.success(t('settings.aboutExportSuccess', { path: res.path }));
    } else {
      toast.error(t('settings.aboutExportFailed'));
    }
  } catch {
    toast.error(t('settings.aboutExportFailed'));
  }
}

/** 打开数据目录（userData；无桥时 no-op——按钮已按 hasIpcBridge 禁用） */
export function openDataDirAction(): void {
  void openDataDir();
}

/**
 * 诊断与支持卡片（复制诊断信息 / 打开数据目录 / 导出诊断包）
 *
 * 抽离动机：这三颗按钮的条件（在途态禁用、无桥禁用、info 为空时禁用复制）
 * 曾是 AboutSection 复杂度的一部分；独立后主组件不再承载这些分支。
 */
export function DiagnosticsCard({
  info,
  locale,
  copying,
  exporting,
  onCopy,
  onExport,
}: {
  readonly info: AppInfoRes | null;
  readonly locale: string;
  readonly copying: boolean;
  readonly exporting: boolean;
  readonly onCopy: (text: string) => void;
  readonly onExport: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const bridgeReady = hasIpcBridge();
  const copyDisabled = copying || info === null;

  const handleCopyDiagnostics = (): void => {
    if (info === null) return;
    onCopy(formatDiagnostics(info, locale));
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleCopyDiagnostics} disabled={copyDisabled}>
          {copying ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Clipboard className="size-3.5" strokeWidth={1.5} />
          )}
          {t('settings.aboutCopyDiagnostics')}
        </Button>
        <Button variant="outline" size="sm" onClick={openDataDirAction} disabled={!bridgeReady}>
          <FolderOpen className="size-3.5" strokeWidth={1.5} />
          {t('settings.aboutOpenDataDir')}
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={exporting || !bridgeReady}>
          {exporting ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <PackageCheck className="size-3.5" strokeWidth={1.5} />
          )}
          {t('settings.aboutExportDiagnostics')}
        </Button>
      </div>
    </Card>
  );
}
