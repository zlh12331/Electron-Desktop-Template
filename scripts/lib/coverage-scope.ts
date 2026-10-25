// scripts/lib/coverage-scope.ts
// 覆盖率范围规则核：把「哪些源码必须出现在覆盖率报告里」变成可测数据。
// 边界：本文件只处理路径与 glob 子集（精确路径 / `dir/**`），不解析 vitest 配置。

import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 覆盖率统计层（lcovPath 为仓库根相对的产物路径，产物统一在根 coverage/<层>/） */
export interface CoverageScope {
  readonly layer: 'main' | 'renderer' | 'shared';
  /** 源码根（相对仓库根） */
  readonly sourceRoot: string;
  /** lcov 文件（相对仓库根） */
  readonly lcovPath: string;
  /** lcov 路径相对源码根需要剥离的前缀（shared 的 lcov 以 src/ 开头） */
  readonly lcovPrefix?: string;
  /** 明确排除且已有 E2E/入口职责的文件或 `dir/**` 前缀 */
  readonly allowed: readonly string[];
}

/** 模板的三层覆盖率范围（renderer 的应用壳由 E2E 覆盖，见 vitest.config.ts 同名单） */
export const COVERAGE_SCOPES: readonly CoverageScope[] = [
  {
    layer: 'main',
    sourceRoot: 'src/main',
    lcovPath: 'coverage/main/lcov.info',
    allowed: ['index.ts'],
  },
  {
    layer: 'renderer',
    sourceRoot: 'src/renderer',
    lcovPath: 'coverage/renderer/lcov.info',
    allowed: [
      'App.tsx',
      'main.tsx',
      'dev/**',
      'components/layout/AppShell.tsx',
      'components/layout/Sidebar.tsx',
      'components/layout/bridges.ts',
      'components/settings/SettingsDialog.tsx',
      'components/settings/sections/registry.tsx',
      'providers/**',
      'router.tsx',
      'routes/**',
      'lib/query/**',
      // 纯 re-export barrel：无执行路径，导出形状由 index.test.ts 验证
      'i18n/index.ts',
      'lib/motion/index.ts',
    ],
  },
  {
    layer: 'shared',
    sourceRoot: 'packages/shared/src',
    lcovPath: 'coverage/shared/lcov.info',
    lcovPrefix: 'src/',
    allowed: ['index.ts'],
  },
];

/** 是否被显式排除（精确路径或 `dir/**` 前缀） */
export function isAllowed(file: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) =>
    entry.endsWith('/**') ? file.startsWith(entry.slice(0, -2)) : file === entry,
  );
}

/** 递归收集源码文件（相对 sourceRoot，POSIX 分隔符；排除测试/配置/声明与生成目录） */
export function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'coverage' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      if (entry.name === 'test' || entry.name === '__tests__') {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }
      if (/\.(test|config)\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) {
        continue;
      }
      out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** 从 lcov 文本提取文件列表（反斜杠归一为 `/`） */
export function parseLcovSourceFiles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('SF:'))
    // lcov 由不同平台生成，统一把 Windows 反斜杠归一为 `/`（不能依赖 host sep）
    .map((line) => line.slice(3).replaceAll('\\', '/'));
}

/** 按层规则比较源码与 lcov；返回未进入覆盖率的源码文件 */
export function findScopeGaps(
  scope: CoverageScope,
  sourceFiles: readonly string[],
  lcovFiles: readonly string[],
): string[] {
  const normalized = new Set(
    lcovFiles.map((file) =>
      scope.lcovPrefix !== undefined && file.startsWith(scope.lcovPrefix)
        ? file.slice(scope.lcovPrefix.length)
        : file,
    ),
  );
  return sourceFiles.filter((file) => !isAllowed(file, scope.allowed) && !normalized.has(file));
}
