import { hasIpcBridge } from './ipc';

let reported = false;

/** 初始路由提交完成，不等同于 OS 已显示窗口或完成所有异步查询。 */
export function reportRendererReady(): void {
  if (import.meta.env.MODE === 'web' || reported || !hasIpcBridge()) return;
  reported = true;
  void window.api.telemetry.rendererReady().catch(() => {});
}
