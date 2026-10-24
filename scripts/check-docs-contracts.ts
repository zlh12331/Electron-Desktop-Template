// scripts/check-docs-contracts.ts
// 文档契约闸：把可机器判定的文档承诺接入 check:static——
// ① IPC 规范的域/通道计数与域清单必须等于 IPC_META；② README/AGENTS 的静态门禁数量必须等于
// check:static 实际链长；③ 文档与源码注释中的 ErrorCode.<KEY> 必须存在；④ 代码路径引用必须存在。
// 运行：pnpm check:docs-contracts；规则核与反例测试见 scripts/lib/docs-contracts.ts(.test.ts)。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { IPC_META } from '@code-agent/shared/ipc/meta';
import { ErrorCode } from '@code-agent/shared/main';

import {
  checkErrorCodeRefs,
  checkGateCount,
  checkIpcSpec,
  checkPathRefs,
  countIpcMeta,
  type DocsContractIssue,
} from './lib/docs-contracts';

/** 仓库根（本脚本位于 scripts/ 下） */
const ROOT = join(import.meta.dirname, '..');

/** IPC 规范文件（计数与域清单的唯一被检对象） */
const IPC_SPEC_FILE = 'docs/design/19-ipc-spec.md';

/** 需要校验静态门禁数量的文档 */
const GATE_COUNT_FILES = ['README.md', 'AGENTS.md'] as const;

/** 根级 Markdown（只收集当前文档，不扫 CHANGELOG/历史记录） */
const ROOT_MARKDOWN = [
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'DESIGN.md',
  'RELEASING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
] as const;

/** 递归时跳过的目录（依赖、构建产物、覆盖率、历史快照） */
const SKIP_DIRS = new Set([
  'node_modules',
  'coverage',
  'dist',
  'out',
  'release',
  '.git',
  '.pnpm-store',
  '.tmp',
  '.electron-user-data',
  '.e2e-user-data',
  'playwright-report',
  'playwright-report-electron',
  'playwright-report-smoke',
  'test-results',
  'history',
]);

/** 源码扫描根（文档中的示例与源码注释都会引用这些路径） */
const SOURCE_ROOTS = ['src', 'packages/shared/src', 'scripts'] as const;

/** 源码扩展名 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/** 是否为源码文件 */
function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** 递归收集 Markdown 与源码文件（相对仓库根，POSIX 分隔符） */
function collectFiles(dir: string, markdownOnly: boolean, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, markdownOnly, acc);
      continue;
    }
    if (entry.name.endsWith('.md') || (!markdownOnly && isSourceFile(entry.name))) {
      acc.push(relative(ROOT, full).split(sep).join('/'));
    }
  }
  return acc;
}

/** 收集待检文件：根级 Markdown + docs/design/guides + observability + 源码 */
function collectTargets(): readonly string[] {
  const markdown = ROOT_MARKDOWN.filter(
    (file) => statSync(join(ROOT, file), { throwIfNoEntry: false }) !== undefined,
  );
  const docs = collectFiles(join(ROOT, 'docs', 'design'), true);
  docs.push(...collectFiles(join(ROOT, 'docs', 'guides'), true));
  if (statSync(join(ROOT, 'docs', 'README.md'), { throwIfNoEntry: false }) !== undefined) {
    docs.push('docs/README.md');
  }
  if (statSync(join(ROOT, 'observability', 'README.md'), { throwIfNoEntry: false }) !== undefined) {
    docs.push('observability/README.md');
  }
  const source = SOURCE_ROOTS.flatMap((dir) => collectFiles(join(ROOT, dir), false));
  return [...new Set([...markdown, ...docs, ...source])].sort();
}

/** 相对仓库根的路径是否真实存在且为文件 */
function fileExists(relativePath: string): boolean {
  const stat = statSync(join(ROOT, relativePath), { throwIfNoEntry: false });
  return stat?.isFile() === true;
}

/** 读取 check:static 链的实际命令数 */
function staticGateCount(): number {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const chain = pkg.scripts?.['check:static'];
  if (chain === undefined) {
    throw new Error('package.json 缺少 check:static 脚本');
  }
  return chain
    .split('&&')
    .map((command) => command.trim())
    .filter((command) => command.length > 0).length;
}

/** 主入口：扫描并输出问题 */
function main(): number {
  const counts = countIpcMeta(IPC_META);
  const gateCount = staticGateCount();
  const codes = new Set(Object.keys(ErrorCode));
  const files = collectTargets();
  const issues: DocsContractIssue[] = [];

  if (!fileExists(IPC_SPEC_FILE)) {
    issues.push({
      file: IPC_SPEC_FILE,
      line: 1,
      rule: 'missing-doc',
      detail: 'IPC 规范文件不存在',
    });
  } else {
    issues.push(
      ...checkIpcSpec(readFileSync(join(ROOT, IPC_SPEC_FILE), 'utf8'), IPC_SPEC_FILE, counts),
    );
  }

  for (const file of files) {
    // 测试文件里的路径/错误码常是故意构造的反例 fixture，不是文档承诺
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const content = readFileSync(join(ROOT, file), 'utf8');
    if (GATE_COUNT_FILES.includes(file as (typeof GATE_COUNT_FILES)[number])) {
      issues.push(...checkGateCount(content, file, gateCount));
    }
    issues.push(...checkErrorCodeRefs(content, file, codes));
    issues.push(...checkPathRefs(content, file, fileExists));
  }

  if (issues.length === 0) {
    console.log(
      `[check-docs-contracts] ✅ 通过：${files.length} 文件；IPC ${counts.domains} 域 / ${counts.requests} request + ${counts.events} event；静态门禁 ${gateCount} 项`,
    );
    return 0;
  }

  console.error(`[check-docs-contracts] ❌ ${issues.length} 处文档契约问题：`);
  for (const issue of issues) {
    console.error(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.detail}`);
  }
  console.error(
    '[check-docs-contracts] 修复指引：以 IPC_META / package.json / ErrorCode / 仓库文件为真源更新文档，不要把历史快照写成现行承诺',
  );
  return 1;
}

process.exitCode = main();
