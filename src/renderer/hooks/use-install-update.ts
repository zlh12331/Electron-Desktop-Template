import { useTranslation } from '@/i18n/use-translation';
import { confirm } from '@/stores/transient/confirm-dialog-store';

/**
 * 返回"重启并安装"动作
 *
 * 安装会退出应用——模板版无运行中任务，故直接确认后触发。
 * 接入业务后若存在进行中的工作，应在此加前置校验（例：有未保存任务时提示会中断）。
 *
 * @example
 * ```tsx
 * const install = useInstallUpdate();
 * <Button onClick={() => void install()}>重启并安装</Button>
 * ```
 */
export function useInstallUpdate(): () => Promise<void> {
  const { t } = useTranslation();

  return async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('update.confirmRestartTitle'),
      message: t('update.confirmRestartMessage'),
      confirmText: t('settings.aboutInstallRestart'),
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    const api = window.api;
    if (api === undefined) {
      return;
    }
    void api.update.install();
  };
}
