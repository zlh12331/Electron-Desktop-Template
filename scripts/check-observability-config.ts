// check-observability-config.ts：可观测性配置门禁——注册表 ↔ 代码/模板/文档/CI 一致性
// 运行：pnpm check:observability-config（并入 check:static）
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { OBSERVABILITY_ENV_ENTRIES } from '@code-agent/shared/observability';

import {
  extractDeclaredEnvKeys,
  extractObservabilityEnvKeys,
  findMissingKeys,
  findUnknownKeys,
  validateRegistry,
} from './lib/observability-config-check';

const ROOT = join(import.meta.dirname, '..');
const SOURCE_DIRS = [
  join(ROOT, 'src'),
  join(ROOT, 'scripts'),
  join(ROOT, 'packages', 'shared', 'src'),
];
const ENV_EXAMPLE = join(ROOT, '.env.example');
const RUNBOOK = join(ROOT, 'docs', 'guides', 'observability-runbook.md');
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');
const ROOT_CONFIG = join(ROOT, 'electron.vite.config.ts');

/** 递归收集 .ts/.tsx 文件（跳过 node_modules/coverage/out） */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === 'out') {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

function main(): number {
  const problems: string[] = [...validateRegistry(OBSERVABILITY_ENV_ENTRIES)];

  const sourceFiles = SOURCE_DIRS.flatMap((dir) => collectSourceFiles(dir));
  const references = new Map<string, ReadonlySet<string>>();
  for (const file of sourceFiles) {
    const keys = extractObservabilityEnvKeys(readFileSync(file, 'utf8'));
    if (keys.size > 0) {
      references.set(relative(ROOT, file).replace(/\\/g, '/'), keys);
    }
  }
  const rootConfigKeys = extractObservabilityEnvKeys(readFileSync(ROOT_CONFIG, 'utf8'));
  if (rootConfigKeys.size > 0) {
    references.set('electron.vite.config.ts', rootConfigKeys);
  }

  for (const file of readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith('.yml'))) {
    const keys = extractDeclaredEnvKeys(readFileSync(join(WORKFLOWS_DIR, file), 'utf8'));
    if (keys.size > 0) {
      references.set(`.github/workflows/${file}`, keys);
    }
  }

  problems.push(...findUnknownKeys(OBSERVABILITY_ENV_ENTRIES, references));

  const envText = readFileSync(ENV_EXAMPLE, 'utf8');
  problems.push(...findMissingKeys(OBSERVABILITY_ENV_ENTRIES, envText, '.env.example'));

  const runbookText = readFileSync(RUNBOOK, 'utf8');
  problems.push(
    ...findMissingKeys(OBSERVABILITY_ENV_ENTRIES, runbookText, 'observability-runbook'),
  );

  if (problems.length > 0) {
    console.error(`[check-observability-config] ❌ ${problems.length} 处不一致：`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  console.log(
    `[check-observability-config] ✅ 通过：${OBSERVABILITY_ENV_ENTRIES.length} 个变量在注册表/代码/.env.example/运行手册/CI 一致`,
  );
  return 0;
}

process.exit(main());
