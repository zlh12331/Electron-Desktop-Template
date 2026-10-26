// e2e/smoke.prod.spec.ts：生产构建冒烟——用 _electron.launch 直接启动 electron-builder 打包产物
// （release/ 下的 unpacked 可执行文件，而非 dev server），验证打包链路没把应用打坏。
// 只覆盖「能起来」这一层：主界面渲染 / preload 注入 / IPC 全链路（含 SQLite 初始化）/ 启动耗时；
// dev 专属行为不在生产构建里（React DevTools 仅在 !app.isPackaged 时安装，src/main/window.ts），
// 那部分由 e2e/electron.spec.ts 覆盖。
// 前置：pnpm build:dist 产出 release/；运行 pnpm test:smoke（release.yml 各平台 build job 同用此命令）。

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXECUTABLE_NAME, PRODUCT_NAME } from '@code-agent/shared/renderer';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';

import { closeElectronApp } from './helpers/close-electron';
import { buildElectronEnv } from './helpers/electron-env';
import { recordStartupMeasurement } from './helpers/startup-history';

// 产物名取自品牌真源（app.config.json → brand.ts），与 electron-builder.yml 的
// productName / linux.executableName 同源——改品牌只需跑 init:template，无需改本文件
const LINUX_EXECUTABLE = EXECUTABLE_NAME;

/** 当前架构对应的 unpacked 目录后缀（x64 为默认架构，无后缀） */
const ARCH_SUFFIX = process.arch === 'arm64' ? '-arm64' : '';

/**
 * 按候选顺序返回第一个存在的路径。
 *
 * 全都不存在时返回首选路径，好让调用方的前置检查以「可执行文件不存在」报错，而不是得到空串。
 */
function firstExisting(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? '';
}

// 打包产物路径按平台解析（unpacked 目录名带架构后缀，x64 无后缀——见 ARCH_SUFFIX）：
// Windows/Linux 为 release/<platform>[-arm64]-unpacked/，macOS 为 release/mac[-arm64|-x64]/*.app/Contents/MacOS/。
// 候选顺序把当前进程架构的目录排前：只有本机架构的构建才一定能在本机启动，其余目录仅作回退。
function resolvePackagedExecutable(): string {
  const releaseDir = join(process.cwd(), 'release');
  if (process.platform === 'win32') {
    return firstExisting(
      [`win${ARCH_SUFFIX}-unpacked`, 'win-unpacked'].map((dir) =>
        join(releaseDir, dir, `${PRODUCT_NAME}.exe`),
      ),
    );
  }
  if (process.platform === 'linux') {
    return firstExisting(
      [`linux${ARCH_SUFFIX}-unpacked`, 'linux-unpacked'].map((dir) =>
        join(releaseDir, dir, LINUX_EXECUTABLE),
      ),
    );
  }
  const preferred =
    process.arch === 'arm64' ? ['mac-arm64', 'mac'] : ['mac', 'mac-arm64', 'mac-x64'];
  return firstExisting(
    preferred.map((dirName) =>
      join(releaseDir, dirName, `${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME),
    ),
  );
}

const EXECUTABLE_PATH = resolvePackagedExecutable();

/** 启动打包产物并返回 DOM 就绪的首窗；可执行文件缺失时抛出带构建提示的错误 */
async function launchPackagedApp(
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  if (!existsSync(EXECUTABLE_PATH)) {
    throw new Error(`可执行文件不存在：${EXECUTABLE_PATH}\n请先执行 pnpm build:dist 生成打包产物`);
  }

  const app = await electron.launch({
    executablePath: EXECUTABLE_PATH,
    // buildElectronEnv 会剥离 IDE/Agent 终端注入的 ELECTRON_RUN_AS_NODE；
    // 生产构建即使被塞入 ELECTRON_RENDERER_URL 也必须 loadFile 加载打包内的 renderer。
    env: buildElectronEnv({
      // 压成 production：避免 runner 继承的 NODE_ENV=test 影响被测应用的环境判定
      NODE_ENV: 'production',
      ...extraEnv,
    }),
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

test.describe('生产构建冒烟测试', () => {
  let app: ElectronApplication;
  let page: Page;

  // 每条用例独立启停应用：避免残留窗口 / 单实例锁（src/main/index.ts）影响下一条
  test.afterEach(async () => {
    if (app) {
      // 关窗默认最小化到托盘（closeAction=minimize），app.close() 不会等到进程退出，
      // 故走带超时强杀的统一助手
      await closeElectronApp(app);
    }
  });

  test('应用启动并渲染主界面', async () => {
    ({ app, page } = await launchPackagedApp());

    const title = await page.title();
    expect(title).toContain(PRODUCT_NAME);

    const rootChildCount = await page.evaluate(() => {
      const root = document.getElementById('root');
      return root?.childElementCount ?? 0;
    });
    expect(rootChildCount).toBeGreaterThan(0);
  });

  test('打包态忽略 dev/test 环境变量：ELECTRON_RENDERER_URL 不得改写加载源', async () => {
    ({ app, page } = await launchPackagedApp({
      ELECTRON_RENDERER_URL: 'https://example.com',
      APP_SKIP_CLOSE_GUARD: '1',
    }));

    expect(page.url()).toMatch(/^file:\/\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  test('window.api 全部域已注入（preload 正常加载）', async () => {
    ({ app, page } = await launchPackagedApp());

    const apiKeys = await page.evaluate(() => {
      if (typeof window.api === 'undefined') return null;
      return Object.keys(window.api);
    });

    expect(apiKeys).not.toBeNull();
    // 这里只抽样关键域（完整清单真源：packages/shared/src/ipc/meta.ts）；
    // preload 能注入这些域即说明 window.api 由契约表生成。
    for (const domain of [
      'app',
      'window',
      'dialog',
      'settings',
      'system',
      'logs',
      'devtools',
      'backup',
      'update',
      'proxy',
      'invalidation',
    ]) {
      expect(apiKeys).toContain(domain);
    }
  });

  test('IPC 全链路：settings/getAll 返回设置快照（SQLite 初始化成功）', async () => {
    ({ app, page } = await launchPackagedApp());

    const result = await page.evaluate(async () => {
      const res = await window.api.settings.getAll({});
      return {
        hasError: 'error' in res,
        hasData: 'data' in res,
      };
    });

    // settings/getAll 直连 SQLite：返回 data 即证明打包产物的库初始化（含 drizzle 迁移）成功
    expect(result.hasError).toBe(false);
    expect(result.hasData).toBe(true);
  });

  test('IPC 全链路：system/getStatus 返回运行时状态', async () => {
    ({ app, page } = await launchPackagedApp());

    const result = await page.evaluate(async () => {
      const res = await window.api.system.getStatus();
      return {
        hasError: 'error' in res,
        hasData: 'data' in res,
        isPackaged: 'data' in res ? (res.data as { isPackaged?: boolean }).isPackaged : null,
      };
    });

    expect(result.hasError).toBe(false);
    expect(result.hasData).toBe(true);
    // isPackaged 取自 Electron 的 app.isPackaged（src/main/ipc/system.handler.ts）：
    // 断言 true 才说明被测的是打包产物本身，而非源码启动
    expect(result.isPackaged).toBe(true);
  });

  test('生产构建启动到可交互 < 10s（分段报告）', async () => {
    // 前置检查与 launchPackagedApp 等价，但本用例要分段计时，故不共用而独立实现
    if (!existsSync(EXECUTABLE_PATH)) {
      throw new Error(
        `可执行文件不存在：${EXECUTABLE_PATH}\n请先执行 pnpm build:dist 生成打包产物`,
      );
    }

    const t0 = Date.now();
    const launchApp = await electron.launch({
      executablePath: EXECUTABLE_PATH,
      env: { ...process.env, NODE_ENV: 'production' },
    });
    const t1 = Date.now(); // 进程启动 + 首窗口创建

    const page = await launchApp.firstWindow();
    const t2 = Date.now(); // 首窗口可用

    await page.waitForLoadState('domcontentloaded');
    const t3 = Date.now(); // DOM 加载完成

    // UI 就绪判据：React 挂载后才会渲染出欢迎页标题（src/renderer/routes/home.tsx）
    const heading = page.getByRole('heading', { level: 1 }).first();
    // 单步上限 15s，宽于总预算 10s：冷启动慢时报「标题始终不可见」，即 React 未挂载这一具体症状
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const t4 = Date.now();

    // 「可交互」判据：主按钮可点击（h1 不可聚焦，对非可聚焦元素调用 focus() 会抛内部错误）
    const primaryAction = page.getByRole('button', { name: /查看说明|Read more/ }).first();
    await expect(primaryAction).toBeEnabled({ timeout: 5_000 });
    await primaryAction.click();
    const t5 = Date.now();

    const total = t5 - t0;
    console.log(
      `[perf:startup] 生产启动分段：launch ${t1 - t0}ms / firstWindow ${t2 - t1}ms / dom ${t3 - t2}ms / React 首屏 ${t4 - t3}ms / 可交互 ${t5 - t4}ms / 合计 ${total}ms`,
    );
    const trend = recordStartupMeasurement({
      launchMs: t1 - t0,
      firstWindowMs: t2 - t1,
      domMs: t3 - t2,
      firstPaintMs: t4 - t3,
      interactiveMs: t5 - t4,
      totalMs: total,
    });
    // 环比只告警不卡关：CI 共享 runner 的单次抖动不足以否定构建；绝对预算仍由下一行硬卡
    if (trend.deltaPct !== null && Math.abs(trend.deltaPct) > 20) {
      console.warn(
        `[perf:startup] ⚠️ 合计耗时环比 ${trend.deltaPct > 0 ? '+' : ''}${trend.deltaPct}%（样本 ${trend.samples}），请检查是否引入回归`,
      );
    }
    test.info().annotations.push({
      type: 'startup-trend',
      description: `samples=${trend.samples} delta=${trend.deltaPct ?? 'n/a'}%`,
    });
    expect(total, '生产构建冷启动到可交互应 < 10s（基线，渐进收紧）').toBeLessThan(10_000);

    await closeElectronApp(launchApp);
  });

  test('hash 路由导航后 IPC 仍可用（About → 首页）', async () => {
    ({ app, page } = await launchPackagedApp());

    const callAppInfo = (): Promise<unknown> =>
      page.evaluate(async () => {
        const response = await window.api.app.getInfo();
        if ('error' in response) {
          throw new Error(`IPC 失败：${response.error.code}`);
        }
        return response.data;
      });

    await expect.poll(async () => (await callAppInfo()) !== null).toBe(true);

    await page
      .getByRole('button', { name: /查看说明|Read more/i })
      .first()
      .click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/about');
    await expect.poll(async () => (await callAppInfo()) !== null).toBe(true);

    await page
      .getByRole('button', { name: /返回|Back/i })
      .first()
      .click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/');
    await expect.poll(async () => (await callAppInfo()) !== null).toBe(true);
  });

  test('生产 CSP 拦截注入的内联脚本', async () => {
    ({ app, page } = await launchPackagedApp());

    const inlineExecuted = await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__cspInlineProbe = true';
      document.head.appendChild(script);
      return (window as Window & { __cspInlineProbe?: boolean }).__cspInlineProbe === true;
    });

    expect(inlineExecuted).toBe(false);
  });

  test('应用无控制台错误', async () => {
    ({ app, page } = await launchPackagedApp());

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    // 渲染期报错在 load 之后才到达，没有「收齐」事件可等，故留固定观察窗口
    await page.waitForTimeout(2000);

    // 滤掉非阻塞噪音（DevTools 安装提示、CSP 相关输出）：它们不代表业务回归，但会让用例常红
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('DevTools') &&
        !e.includes('Download the React DevTools') &&
        !e.includes('Content Security Policy'),
    );

    expect(criticalErrors).toEqual([]);
  });
});
