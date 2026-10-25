// wait-window.ts：等待 Electron 主窗口（过滤 devtools://），供 file 模式与窗口类 E2E 复用
import type { ElectronApplication, Page } from '@playwright/test';

/**
 * 等待第一个非 DevTools 窗口
 *
 * dev 模式会主动打开 DevTools，`app.firstWindow()`/`app.windows()[0]` 可能指向
 * devtools:// 目标；业务断言必须落在主窗口上。
 *
 * @param app Playwright 的 Electron 应用实例
 * @param timeoutMs 超时（默认 20s）
 * @returns 主窗口 Page
 */
export async function waitForMainWindow(
  app: ElectronApplication,
  timeoutMs = 20_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const existing = app.windows().find((window) => !window.url().startsWith('devtools://'));
    if (existing !== undefined) {
      return existing;
    }
    await Promise.race([
      app.waitForEvent('window'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  throw new Error(`等待主窗口超时（${timeoutMs}ms）：仅出现 DevTools 窗口`);
}
