import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'postinstall-rebuild.mjs');

describe('postinstall（真实入口，安装器与编译器使用本地 fixture）', () => {
  let root: string;
  let installer: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'template install '));
    const electronDir = join(root, 'node_modules/electron');
    const rebuildDir = join(root, 'node_modules/@electron/rebuild/lib');
    mkdirSync(electronDir, { recursive: true });
    mkdirSync(rebuildDir, { recursive: true });
    installer = join(electronDir, 'install.js');
    writeFileSync(
      installer,
      `const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync('steps.txt', 'install\\n');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/electron'), 'fixture');
fs.writeFileSync(path.join(__dirname, 'path.txt'), 'electron');`,
    );
    writeFileSync(
      join(rebuildDir, 'cli.js'),
      "require('node:fs').appendFileSync('steps.txt', 'rebuild\\n');",
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(skipRebuild = ''): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      env: {
        ...process.env,
        ['SKIP_ELECTRON_REBUILD']: skipRebuild,
        ['ELECTRON_OVERRIDE_DIST_PATH']: '',
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
  }

  it('先安装 Electron，再重编原生模块（支持含空格目录）', () => {
    const result = run();
    expect(result.status, String(result.stderr)).toBe(0);
    expect(readFileSync(join(root, 'steps.txt'), 'utf8')).toBe('install\nrebuild\n');
  });

  it('安装失败保留退出码，且不继续编译', () => {
    writeFileSync(installer, 'process.exit(7);');
    const result = run();
    expect(result.status).toBe(7);
  });

  it('安装器返回成功但二进制缺失时拒绝假成功', () => {
    writeFileSync(installer, 'process.exit(0);');
    const result = run();
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain('Electron 二进制缺失');
  });

  it('跳过原生重编仍会安装 Electron', () => {
    const result = run('1');
    expect(result.status, String(result.stderr)).toBe(0);
    expect(readFileSync(join(root, 'steps.txt'), 'utf8')).toBe('install\n');
  });
});
