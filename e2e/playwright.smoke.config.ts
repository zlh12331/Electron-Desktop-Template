// playwright.smoke.config.ts：生产构建冒烟配置，让 e2e/smoke.prod.spec.ts 跑在 electron-builder 打包产物上
// 前置：先 `pnpm build:dist` 产出 release/ 下的 unpacked 目录（入口脚本 `pnpm test:smoke`）；
// 与 playwright.config.ts / playwright.electron.config.ts 的分界：那两个起 dev server 驱动源码，这里只驱动打包可执行文件

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// 仓库根：报告目录必须按 ROOT 拼绝对路径。相对路径按配置文件所在目录（e2e/）解析，
// 报告会落到 e2e/playwright-report-smoke/，与 .gitignore 的根级规则和其余两套配置不一致
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: '.',
  // 只收打包冒烟：同名系的 e2e/smoke.spec.ts 是浏览器模式（page.goto('/')，靠 dev server + baseURL），归 playwright.config.ts
  testMatch: '**/smoke.prod.spec.ts',
  // 下限受用例内显式等待约束（输入框可见性断言 15s），余量留给打包应用冷启动
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // 打包应用取单实例锁（src/main/index.ts），并发启动会让后起实例抢锁失败、直接退出
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: join(ROOT, 'playwright-report-smoke') }],
  ],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  // 不设 webServer：打包产物由主进程 loadFile 加载本地页面（src/main/window.ts），不经 dev server
});
