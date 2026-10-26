// electron-deeplink.spec.ts：冷启动深链 E2E——启动参数带协议 URL，渲染层挂载后取走暂存值并导航
// 覆盖「createWindow 返回时渲染层尚未订阅」的真实时序：主进程暂存 + app:takePendingDeepLink 补齐。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';

import { closeElectronApp } from './helpers/close-electron';
import { buildElectronEnv } from './helpers/electron-env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js');
const E2E_USER_DATA = join(__dirname, '..', '.e2e-user-data-deeplink');
const DEBUG_PORT = '9226';
const DEEP_LINK = 'electron-template://open/e2e-deep-link';

async function waitForMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const existing = app.windows().find((w) => !w.url().startsWith('devtools://'));
    if (existing !== undefined) {
      return existing;
    }
    await Promise.race([
      app.waitForEvent('window'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  throw new Error('等待主窗口超时（20s）：仅出现 DevTools 窗口');
}

test('冷启动深链：渲染层就绪后从主进程取走暂存并导航', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, DEEP_LINK],
    env: buildElectronEnv({
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      APP_USER_DATA: E2E_USER_DATA,
      APP_DEBUG_PORT: DEBUG_PORT,
      APP_SKIP_CLOSE_GUARD: '1',
    }),
  });

  try {
    const page = await waitForMainWindow(app);
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/#\/notes\/e2e-deep-link$/, { timeout: 15_000 });
    await expect(page.getByText('笔记不存在')).toBeVisible();
  } finally {
    await closeElectronApp(app);
  }
});
