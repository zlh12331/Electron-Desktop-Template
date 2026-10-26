// vitest.config.ts：preload 单测配置（pnpm test:preload 的 --root 指向本目录）。
// preload 是 CJS + sandbox 的独立运行面，单独成层，避免被 main/renderer 的覆盖率平均掩盖。
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

type FloorsFile = {
  layers: {
    preload: {
      floor: { statements: number; branches: number; functions: number; lines: number };
    };
  };
};
const preloadFloor = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../scripts/coverage-floors.json'), 'utf-8'),
  ) as FloorsFile
).layers.preload.floor;

// biome-ignore lint/style/noDefaultExport: vitest config 框架要求必须使用 export default
export default defineConfig({
  cacheDir: resolve(import.meta.dirname, '../../node_modules/.vite/preload'),
  test: {
    globals: true,
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/preload',
      reporter: ['text', 'html', 'lcov'],
      // 显式 include：未被测试导入的桥接模块也进入分母
      include: ['**/*.ts'],
      thresholds: {
        statements: preloadFloor.statements,
        branches: preloadFloor.branches,
        functions: preloadFloor.functions,
        lines: preloadFloor.lines,
      },
      // index.ts 是 contextBridge 入口，由 Electron E2E 覆盖；其余桥接逻辑必须单测
      exclude: ['**/*.test.ts', '**/*.config.ts', '**/*.d.ts', 'index.ts'],
    },
  },
});
