// scripts/check-critical-coverage.ts
// 关键模块覆盖率门禁：按文件阈值卡关，防止高风险模块被全局平均掩盖。
// 运行：pnpm check:critical-coverage（需先跑 pnpm test:coverage 生成 lcov）

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateCriticalCoverage, parseLcovCoverage } from './lib/critical-coverage';

const ROOT = join(import.meta.dirname, '..');
const LCOV: Readonly<Record<'main' | 'renderer' | 'shared', string>> = {
  main: 'src/main/coverage/lcov.info',
  renderer: 'src/renderer/coverage/lcov.info',
  shared: 'packages/shared/coverage/lcov.info',
};

function main(): number {
  const coverage = {} as Record<
    'main' | 'renderer' | 'shared',
    ReturnType<typeof parseLcovCoverage>
  >;
  const missing: string[] = [];
  for (const [layer, path] of Object.entries(LCOV) as Array<
    ['main' | 'renderer' | 'shared', string]
  >) {
    const file = join(ROOT, path);
    if (!existsSync(file)) {
      missing.push(path);
      coverage[layer] = new Map();
      continue;
    }
    coverage[layer] = parseLcovCoverage(readFileSync(file, 'utf8'));
  }

  const issues = [
    ...missing.map((path) => `缺少 ${path}（先跑 pnpm test:coverage）`),
    ...evaluateCriticalCoverage(coverage),
  ];
  if (issues.length > 0) {
    console.error('[check-critical-coverage] ❌ 关键模块覆盖率不达标：');
    for (const issue of issues) console.error(`  ${issue}`);
    console.error(
      '[check-critical-coverage] 修复：补关键分支测试；不要降低 scripts/lib/critical-coverage.ts 的阈值',
    );
    return 1;
  }
  console.log('[check-critical-coverage] ✅ 通过：关键模块覆盖率均在阈值以上');
  return 0;
}

process.exitCode = main();
