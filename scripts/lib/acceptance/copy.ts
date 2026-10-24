// scripts/lib/acceptance/copy.ts
// 干净副本：只复制 git 跟踪文件，不复制 node_modules / 运行数据 / 构建产物。

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 把仓库中所有 git 跟踪文件复制到目标目录
 *
 * @param root 源仓库根
 * @param destination 目标目录（须已存在）
 * @returns 复制的文件数
 * @throws Error 遇到符号链接或 git 不可用时
 */
export function copyTrackedFiles(root: string, destination: string): number {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const files = output.split('\0').filter((file) => file !== '');
  for (const relativePath of files) {
    const source = join(root, relativePath);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) {
      throw new Error(`验收副本不支持符号链接：${relativePath}`);
    }
    const target = join(destination, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    chmodSync(target, stat.mode);
  }
  return files.length;
}

/**
 * 在副本中初始化无远端的 git 仓库（生成 build-info 时允许无 commit）
 *
 * @param root 副本根
 */
export function initGitRepository(root: string): void {
  execFileSync('git', ['init', '--initial-branch=main'], {
    cwd: root,
    stdio: 'ignore',
  });
}
