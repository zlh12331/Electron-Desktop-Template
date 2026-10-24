// playwright.visual.config.ts：视觉回归配置——只在 Windows 运行，
// 基线也按 Windows 渲染生成，避免 Linux/Windows 字体抗锯齿差异造成长期假红。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// biome-ignore lint/style/noDefaultExport: Playwright 配置文件要求 default export
export default defineConfig({
  testDir: '.',
  testMatch: '**/visual.spec.ts',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--font-render-hinting=none'] },
  },
  webServer: {
    command: 'pnpm exec vite --config vite.web.config.ts --mode web',
    cwd: ROOT,
    url: 'http://localhost:5199',
    timeout: 60_000,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
