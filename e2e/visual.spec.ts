// visual.spec.ts：3 张稳定视觉基线（首页暗/亮、设置通用页）。
// 只由 playwright.visual.config.ts 在 Windows 运行；基线更新：pnpm test:visual --update-snapshots。
import { expect, type Page, test } from '@playwright/test';

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(300);
}

test('首页暗色基线（跟随系统）', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settle(page);
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page).toHaveScreenshot('home-dark.png');
});

test('首页亮色基线（跟随系统）', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await settle(page);
  await expect(page).toHaveScreenshot('home-light.png');
});

test('设置通用页基线', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('通用设置')).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-general.png');
});
