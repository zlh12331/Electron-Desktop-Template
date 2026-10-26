// notes.spec.ts：Local Notes 参考切片的浏览器模式端到端用例——新建 → 编辑保存 → 搜索 → 删除。
// web 模式（--mode web，window.api 由 dev/mock-api.ts 注入）；SQLite 持久化归 Electron 用例。

import { expect, test } from '@playwright/test';

test.describe('Local Notes 参考切片', () => {
  // 预热：vite 冷启动首屏编译慢——先行访问触发编译
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    await page.waitForTimeout(5_000);
    await page.close();
  });

  test('新建 → 编辑保存 → 搜索 → 删除', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '笔记' }).click();
    await expect(page.getByRole('heading', { name: 'Local Notes' })).toBeVisible();

    const list = page.getByRole('complementary', { name: '笔记列表' });
    await expect(list.getByText('欢迎使用 Local Notes')).toBeVisible();

    await page.getByRole('button', { name: '新建笔记' }).first().click();
    await expect(page).toHaveURL(/#\/notes\/[0-9a-f-]+$/);

    await page.getByLabel('标题', { exact: true }).fill('E2E 笔记');
    await page.getByLabel('正文', { exact: true }).fill('第一条正文');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('笔记已保存')).toBeVisible();
    await expect(list.getByText('E2E 笔记')).toBeVisible();

    // 搜索按标题/正文过滤，未命中的初始示例退出列表
    await page.getByRole('textbox', { name: '搜索标题或正文' }).fill('E2E');
    await expect(list.getByText('E2E 笔记')).toBeVisible();
    await expect(list.getByText('欢迎使用 Local Notes')).toHaveCount(0);

    await page.getByRole('button', { name: '删除' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click();
    await expect(page).toHaveURL(/#\/notes$/);
    await expect(page.getByText('笔记已删除')).toBeVisible();
    await expect(list.getByText('E2E 笔记')).toHaveCount(0);
  });

  test('深链目标缺失时展示空态', async ({ page }) => {
    await page.goto('/#/notes/not-a-real-id');
    await expect(page.getByText('笔记不存在')).toBeVisible();
    await expect(page.getByRole('button', { name: '新建笔记' })).toHaveCount(1);
  });
});
