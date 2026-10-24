import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

type FloorsFile = {
  layers: {
    renderer: {
      floor: { statements: number; branches: number; functions: number; lines: number };
    };
  };
};
const rendererFloor = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../scripts/coverage-floors.json'), 'utf-8'),
  ) as FloorsFile
).layers.renderer.floor;

// biome-ignore lint/style/noDefaultExport: vitest config 框架要求必须使用 export default
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // jsdom 环境创建是主要成本；threads 池实测 97s → 32s（2026-10-24，65 文件）。
    // 不用 isolate:false：跨文件复用 worker 会让 window.api / i18n 全局状态互相污染。
    pool: 'threads',
    setupFiles: ['./test/setup-lang.ts', './test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'out/**',
      '../../_template/**',
      '../../src/main/**',
      '../../src/preload/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // 显式 include：未被测试导入的组件/模块也计入分母；dev mock 与入口文件另行排除
      include: ['**/*.{ts,tsx}'],
      thresholds: {
        statements: rendererFloor.statements,
        branches: rendererFloor.branches,
        functions: rendererFloor.functions,
        lines: rendererFloor.lines,
      },
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.config.ts',
        '**/*.d.ts',
        '../../_template/**',
        'test/**',
        'dev/**',
        'coverage/**',
        'main.tsx',
        'App.tsx',
        // 应用壳/路由装配由 browser + Electron E2E 覆盖；单元测试不重复挂载整棵壳
        'components/layout/AppShell.tsx',
        'components/layout/Sidebar.tsx',
        'components/layout/bridges.ts',
        'components/settings/SettingsDialog.tsx',
        'components/settings/sections/registry.tsx',
        'providers/**',
        'router.tsx',
        'routes/**',
        'lib/query/**',
      ],
    },
  },
});
