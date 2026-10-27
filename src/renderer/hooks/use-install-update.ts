/**
 * 返回"重启并安装"动作
 *
 * 模板版无运行中任务，点击即触发安装，不再用确认弹窗增加一步。
 * 接入业务后若存在未保存的工作，应在此加前置校验（例：有未保存任务时提示会中断）。
 *
 * @example
 * ```tsx
 * const install = useInstallUpdate();
 * <Button onClick={() => void install()}>重启并安装</Button>
 * ```
 */
export function useInstallUpdate(): () => Promise<void> {
  return async (): Promise<void> => {
    const api = window.api;
    if (api === undefined) {
      return;
    }
    void api.update.install();
  };
}
