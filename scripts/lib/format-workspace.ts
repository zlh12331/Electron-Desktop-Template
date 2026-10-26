// format-workspace.ts：init:template 的最后一步——用仓库自带的 Biome 重排代码。
// 为什么需要：内部 scope 重写会改变 import 行宽（`@code-agent/x` → 更长的派生 scope），
// 派生项目首次 `pnpm lint` 会因格式不符而红。这里只做 formatter，不跑 lint 修复。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 用 Biome 格式化整个仓库
 *
 * @param root 仓库根
 * @returns true = 已执行且成功；false = 未安装 Biome 或执行失败（调用方提示手动 lint:fix）
 */
export function formatWorkspace(root: string): boolean {
  const bin = join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'biome.cmd' : 'biome',
  );
  if (!existsSync(bin)) {
    return false;
  }
  const result = spawnSync(bin, ['format', '--write', '.'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

/**
 * dry-run 不落盘；无 Biome 时提示手动格式化（不阻断初始化）
 *
 * @param root 仓库根
 * @param dryRun true = 跳过格式化
 */
export function formatWorkspaceOrWarn(root: string, dryRun: boolean): void {
  if (dryRun || formatWorkspace(root)) {
    return;
  }
  console.log('  ⚠ 未找到 Biome，安装依赖后运行 pnpm lint:fix');
}
