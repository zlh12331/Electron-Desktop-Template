import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearUserReadGrants, grantUserReadPaths, isUserGrantedRead } from './user-grants';

let tempDir: string;

describe('user-grants（用户对话框授权路径）', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'user-grants-'));
    clearUserReadGrants();
  });

  afterEach(() => {
    clearUserReadGrants();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('授权文件后可读；其祖先与子路径不受影响', () => {
    const file = join(tempDir, 'note.txt');
    writeFileSync(file, 'x');

    expect(grantUserReadPaths([file])).toBe(1);
    expect(isUserGrantedRead(file)).toBe(true);
    expect(isUserGrantedRead(tempDir)).toBe(false);
    expect(isUserGrantedRead(join(tempDir, 'other.txt'))).toBe(false);
  });

  it('授权目录后其子文件可读（祖先目录匹配）', () => {
    const dir = join(tempDir, 'workspace');
    const nested = join(dir, 'deep', 'file.txt');
    mkdirSync(join(dir, 'deep'), { recursive: true });
    writeFileSync(nested, 'x');

    grantUserReadPaths([dir]);
    expect(isUserGrantedRead(nested)).toBe(true);
  });

  it('相对路径、空串、不存在的路径不登记', () => {
    expect(grantUserReadPaths(['relative/file.txt', '', join(tempDir, 'missing.txt')])).toBe(0);
    expect(isUserGrantedRead('relative/file.txt')).toBe(false);
  });

  it('重复授权只刷新 LRU，不重复计数', () => {
    const file = join(tempDir, 'again.txt');
    writeFileSync(file, 'x');
    expect(grantUserReadPaths([file])).toBe(1);
    expect(grantUserReadPaths([file])).toBe(0);
  });

  it('超过 200 条后淘汰最旧授权', () => {
    const paths: string[] = [];
    for (let i = 0; i < 201; i += 1) {
      const file = join(tempDir, `file-${String(i)}.txt`);
      writeFileSync(file, 'x');
      paths.push(file);
    }
    grantUserReadPaths(paths);

    const first = paths[0];
    const last = paths[200];
    if (first === undefined || last === undefined) {
      throw new Error('测试路径构造失败');
    }
    expect(isUserGrantedRead(first)).toBe(false);
    expect(isUserGrantedRead(last)).toBe(true);
  });
});
