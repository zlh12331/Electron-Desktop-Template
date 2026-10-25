// e2e/smoke.spec.ts：浏览器模式最小冒烟——应用壳启动后能渲染（品牌 / 欢迎页 / 主题按钮）
// 边界：window.api 来自 src/renderer/dev/mock-api.ts，不起 Electron；
// 打包产物的启动校验见 e2e/smoke.prod.spec.ts（pnpm test:smoke）。

import { PRODUCT_NAME } from '@code-agent/shared/renderer';
import { expect, test } from '@playwright/test';

test.describe('冒烟测试：应用启动', () => {
  test('应用启动后页面正常渲染', async ({ page }) => {
    await page.goto('/');
    // 顶栏品牌可见 = 外壳已渲染（perf 系列 spec 同款就绪信号）。
    // 首次页面请求要等 vite dev server 按需编译，超出配置默认的 5s expect 超时（e2e/playwright.config.ts），故放宽到 15s
    await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible({ timeout: 15_000 });
  });

  test('首页渲染欢迎页内容', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /打开设置/ }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('主题切换按钮可点击', async ({ page }) => {
    await page.goto('/');

    // 按 aria-label 定位：名字取自 i18n 文案 topbar.toggleTheme（默认语言 zh-CN），改文案须同步这里
    const themeButton = page.getByRole('button', { name: '切换主题' });
    await expect(themeButton).toBeVisible({ timeout: 10_000 });
    await themeButton.click();
  });

  test('设置弹层按需加载：启动不请求 SettingsDialog', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(requests.some((url) => url.includes('SettingsDialog'))).toBe(false);

    await page.getByRole('button', { name: '打开设置' }).first().click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => requests.some((url) => url.includes('SettingsDialog'))).toBe(true);
  });
});
