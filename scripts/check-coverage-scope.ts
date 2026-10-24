// scripts/check-coverage-scope.ts
// 覆盖率范围门禁：源码文件必须出现在对应层 lcov 中，除非显式登记为入口/E2E 责任。
// 运行：pnpm check:coverage-scope（需先跑 pnpm test:coverage 生成 lcov）

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COVERAGE_SCOPES,
  collectSourceFiles,
  findScopeGaps,
  parseLcovSourceFiles,
} from './lib/coverage-scope';

const ROOT = join(import.meta.dirname, '..');

function main(): number {
  const issues: string[] = [];
  for (const scope of COVERAGE_SCOPES) {
    const lcovPath = join(ROOT, scope.lcovPath);
    if (!existsSync(lcovPath)) {
      issues.push(`${scope.layer}: 缺少 ${scope.lcovPath}（先跑 pnpm test:coverage）`);
      continue;
    }
    const sourceFiles = collectSourceFiles(join(ROOT, scope.sourceRoot));
    const lcovFiles = parseLcovSourceFiles(readFileSync(lcovPath, 'utf8'));
    const gaps = findScopeGaps(scope, sourceFiles, lcovFiles);
    if (gaps.length > 0) {
      issues.push(`${scope.layer}: ${gaps.length} 个源码文件不在覆盖率报告中：${gaps.join(', ')}`);
    }
  }

  if (issues.length > 0) {
    console.error('[check-coverage-scope] ❌ 覆盖率范围缺口：');
    for (const issue of issues) console.error(`  ${issue}`);
    console.error(
      '[check-coverage-scope] 修复：把文件纳入 coverage.include，或在 scripts/lib/coverage-scope.ts 登记为入口/E2E 责任并说明理由',
    );
    return 1;
  }
  console.log(
    `[check-coverage-scope] ✅ 通过：${COVERAGE_SCOPES.length} 层源码均进入覆盖率报告（显式排除项除外）`,
  );
  return 0;
}

process.exitCode = main();
