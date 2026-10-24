// a11y.spec.ts：可访问性扫描（WCAG 2.1 AA）——浏览器模式 E2E，window.api 由 dev/mock-api.ts 注入
// 覆盖当前模板保留的界面：首页亮/暗双主题、关于页、设置全部分区、命令面板、快捷键帮助。
// 为什么扫描前等待：页面与弹层带过渡动画，过早扫描会取到半透明中间态而产生假对比度违规。

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** WCAG 2.0/2.1 的 A + AA 规则集（axe 按 tag 交集启用规则） */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** 设置导航分区（顺序与 registry 一致；文案固定为 zh-CN，与 mock 设置的默认语言一致） */
const SETTINGS_SECTIONS = [
  '通用',
  '外观与缩放',
  '通知',
  '数据',
  '凭据',
  '网络代理',
  '快捷键',
  '关于',
] as const;

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;

/** 等首载与过渡动画稳定：networkidle 收异步数据，短暂等待收 CSS/动效 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

/** 扫描当前页面并返回违规项（零违规为空数组） */
async function scan(page: Page): Promise<AxeResults['violations']> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations;
}

/** 违规压成一行可读文本：规则 + 影响级别 + 命中元素与失败原因 */
function formatViolations(scope: string, violations: AxeResults['violations']): string[] {
  return violations.map((violation) => {
    const nodes = violation.nodes
      .map((node) => {
        const summary = node.failureSummary?.replaceAll('\n', ' ') ?? '';
        return `${JSON.stringify(node.target)} ${summary} html=${node.html.slice(0, 160)}`;
      })
      .join(' | ');
    return `${scope} → ${violation.id}（${violation.impact ?? 'unknown'}）：${violation.help}；${nodes}`;
  });
}

test.describe('可访问性（WCAG 2.1 AA）', () => {
  // 预热：vite 冷启动首屏编译慢——先行访问触发编译
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    await page.waitForTimeout(5_000);
    await page.close();
  });

  test('首页：亮/暗双主题', async ({ page }) => {
    const violations: string[] = [];

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    // mock 设置默认 dark；先扫暗色
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    violations.push(...formatViolations('首页/暗色', await scan(page)));

    // 顶栏主题按钮循环 dark → light：断言 class 真落地，防只切 store 未应用
    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await settle(page);
    violations.push(...formatViolations('首页/亮色', await scan(page)));

    expect(violations).toEqual([]);
  });

  test('关于页', async ({ page }) => {
    await page.goto('/#/about');
    await expect(page.getByRole('heading', { name: '关于本模板' })).toBeVisible();
    await settle(page);
    expect(formatViolations('关于页', await scan(page))).toEqual([]);
  });

  test('设置：全部分区', async ({ page }) => {
    const violations: string[] = [];

    await page.goto('/');
    await page.getByRole('button', { name: '打开设置' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await settle(page);

    for (const label of SETTINGS_SECTIONS) {
      const tab = page.getByRole('tab', { name: label, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await page.waitForTimeout(400);
      violations.push(...formatViolations(`设置/${label}`, await scan(page)));
    }

    expect(violations).toEqual([]);
  });

  test('命令面板', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '命令面板' }).click();
    const dialog = page.getByRole('dialog', { name: '命令面板' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    expect(formatViolations('命令面板', await scan(page))).toEqual([]);
  });

  test('快捷键帮助', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('F1');
    const dialog = page.getByRole('dialog', { name: '快捷键帮助' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    expect(formatViolations('快捷键帮助', await scan(page))).toEqual([]);
  });
});
