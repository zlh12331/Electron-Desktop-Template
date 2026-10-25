// vitest.config.ts：主进程单测配置（pnpm test:main 的 --root 指向本目录）；
// 覆盖率阈值从 scripts/coverage-floors.json 的 main 层读取（数字真源不在本文件）
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

type FloorsFile = {
  layers: {
    main: {
      floor: { statements: number; branches: number; functions: number; lines: number };
    };
  };
};
const mainFloor = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../scripts/coverage-floors.json'), 'utf-8'),
  ) as FloorsFile
).layers.main.floor;

// biome-ignore lint/style/noDefaultExport: vitest config 框架要求必须使用 export default
export default defineConfig({
  // 依赖优化缓存统一落仓库根的 node_modules/.vite/<层>：vitest 默认按 root 解析 cacheDir，
  // 会在这层源码目录下递归建出 node_modules/.vite（生成物不该落在源码树里）
  cacheDir: resolve(import.meta.dirname, '../../node_modules/.vite/main'),
  test: {
    globals: true,
    include: ['**/*.test.ts'],
    exclude: ['**/*.perf.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // 默认只统计被测试导入的文件；显式 include 让未被导入的模块也以 0% 计入，避免高风险模块隐身
      include: ['**/*.ts'],
      thresholds: {
        statements: mainFloor.statements,
        branches: mainFloor.branches,
        functions: mainFloor.functions,
        lines: mainFloor.lines,
      },
      exclude: [
        '**/*.test.ts',
        '**/*.config.ts',
        '**/*.d.ts',
        'out/**',
        'node_modules/**',
        'index.ts',
      ],
    },
  },
});
