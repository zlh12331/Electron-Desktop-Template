// electron-file.spec.ts：file:// 模式（不走 dev server）的导航 + IPC 回归——
// 生产构建用 hash router，sender 校验必须允许 hash；否则进入 About 后所有 IPC 失效。
// 本用例不依赖 electron-builder 产物，用 electron-vite dev 生成的 out/main 启动，
// 但显式清空 ELECTRON_RENDERER_URL，让窗口走 loadFile（与打包态同一 URL 形态）。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';

import { closeElectronApp } from './helpers/close-electron';
import { buildElectronEnv } from './helpers/electron-env';
import { waitForMainWindow } from './helpers/wait-window';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 以仓库根作为 Electron app 路径：app.getAppPath() 等于根目录，
// rendererEntryFileUrl 才能推导出 out/renderer/index.html（与打包态同一形态）。
const APP_ROOT = join(__dirname, '..');
const DEBUG_PORT = '9225';

async function launchFileMode(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [APP_ROOT],
    env: buildElectronEnv({
      NODE_ENV: 'test',
      // 空串 = 不连 dev server，走 loadFile（src/main/window.ts）
      ELECTRON_RENDERER_URL: '',
      APP_USER_DATA: userData,
      APP_DEBUG_PORT: DEBUG_PORT,
      APP_SKIP_CLOSE_GUARD: '1',
    }),
  });

  try {
    const page = await waitForMainWindow(app);
    await page.waitForLoadState('domcontentloaded');
    return { app, page };
  } catch (error) {
    await closeElectronApp(app);
    throw error;
  }
}

async function callAppInfo(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const response = await window.api.app.getInfo();
    if ('error' in response) {
      throw new Error(`IPC 失败：${response.error.code}`);
    }
    return response.data;
  });
}

test.describe('file 模式 hash 路由 IPC', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    if (app !== undefined) {
      await closeElectronApp(app);
      app = undefined;
    }
  });

  test('进入 About 再返回首页，IPC 仍可用', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'electron-file-'));
    try {
      const launched = await launchFileMode(userData);
      app = launched.app;
      const { page } = launched;

      await expect.poll(() => page.url()).not.toContain('#/');
      await expect.poll(async () => (await callAppInfo(page)) !== null).toBe(true);

      await page
        .getByRole('button', { name: /查看说明|Read more/i })
        .first()
        .click();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/about');
      await expect.poll(async () => (await callAppInfo(page)) !== null).toBe(true);

      await page
        .getByRole('button', { name: /返回|Back/i })
        .first()
        .click();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/');
      await expect.poll(async () => (await callAppInfo(page)) !== null).toBe(true);
    } finally {
      if (app !== undefined) {
        await closeElectronApp(app);
        app = undefined;
      }
      rmSync(userData, { recursive: true, force: true });
    }
  });

  test('默认 Ctrl+, 快捷键打开设置', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'electron-file-shortcut-'));
    try {
      const launched = await launchFileMode(userData);
      app = launched.app;
      const { page } = launched;

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.keyboard.press('Control+,');
      await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 10_000 });
    } finally {
      if (app !== undefined) {
        await closeElectronApp(app);
        app = undefined;
      }
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
