import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const hook = require('../after-pack-prune.cjs') as {
  resolveResourcesDir: (context: {
    electronPlatformName: string;
    appOutDir: string;
    packager: { appInfo: { productFilename: string } };
  }) => string;
  pruneBetterSqlite3: (nodeModules: string, platform: string, arch: string) => number;
  pruneSentryNative: (nodeModules: string) => number;
};

function touch(root: string, rel: string, content = 'x'): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function list(root: string, rel: string): string[] {
  return readdirSync(join(root, rel)).sort();
}

describe('afterPack 原生载荷裁剪', () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('better-sqlite3：只保留目标 prebuild，删除源码与编译工程', () => {
    root = mkdtempSync(join(tmpdir(), 'after-pack-sqlite-'));
    const nm = join(root, 'node_modules');
    touch(nm, 'better-sqlite3/package.json');
    touch(nm, 'better-sqlite3/binding.gyp');
    touch(nm, 'better-sqlite3/deps/sqlite3/sqlite3.c');
    touch(nm, 'better-sqlite3/src/objects/database.cpp');
    touch(nm, 'better-sqlite3/build/Release/obj/x.tlog');
    for (const name of [
      'win32-x64.node',
      'win32-arm64.node',
      'linux-x64.node',
      'linuxmusl-x64.node',
      'darwin-arm64.node',
    ]) {
      touch(nm, `better-sqlite3/prebuilds/${name}`);
    }

    const freed = hook.pruneBetterSqlite3(nm, 'win32', 'x64');

    expect(freed).toBeGreaterThan(0);
    expect(list(nm, 'better-sqlite3/prebuilds')).toEqual(['win32-x64.node']);
    expect(list(nm, 'better-sqlite3')).toEqual(['package.json', 'prebuilds']);
  });

  it('better-sqlite3：Linux 同时保留 glibc/musl 同架构 prebuild', () => {
    root = mkdtempSync(join(tmpdir(), 'after-pack-linux-'));
    const nm = join(root, 'node_modules');
    touch(nm, 'better-sqlite3/prebuilds/linux-x64.node');
    touch(nm, 'better-sqlite3/prebuilds/linuxmusl-x64.node');
    touch(nm, 'better-sqlite3/prebuilds/win32-x64.node');

    hook.pruneBetterSqlite3(nm, 'linux', 'x64');

    expect(list(nm, 'better-sqlite3/prebuilds')).toEqual(['linux-x64.node', 'linuxmusl-x64.node']);
  });

  it('Sentry：保留 Electron 使用的 stack-trace.node，删除 ABI 矩阵与调试符号', () => {
    root = mkdtempSync(join(tmpdir(), 'after-pack-sentry-'));
    const nm = join(root, 'node_modules');
    touch(nm, '@sentry/node-native-stacktrace/lib/index.js');
    touch(nm, '@sentry/node-native-stacktrace/lib/stack-trace-win32-x64-137.node');
    touch(nm, '@sentry/node-native-stacktrace/lib/stack-trace-darwin-arm64-127.node');
    touch(nm, '@sentry/node-native-stacktrace/bin/win32-x64-149/node-native-stacktrace.node');
    touch(nm, '@sentry/node-native-stacktrace/build/Release/stack-trace.node');
    touch(nm, '@sentry/node-native-stacktrace/build/Release/stack-trace.iobj');
    touch(nm, '@sentry/node-native-stacktrace/build/Release/stack-trace.ipdb');
    touch(nm, '@sentry/node-native-stacktrace/build/Release/obj/x.tlog');

    hook.pruneSentryNative(nm);

    expect(list(nm, '@sentry/node-native-stacktrace')).toEqual(['build', 'lib']);
    expect(list(nm, '@sentry/node-native-stacktrace/lib')).toEqual(['index.js']);
    expect(list(nm, '@sentry/node-native-stacktrace/build/Release')).toEqual(['stack-trace.node']);
  });

  it('资源目录：macOS 走 .app/Contents/Resources，Windows/Linux 走 resources', () => {
    const base = {
      appOutDir: join('C:', 'out'),
      packager: { appInfo: { productFilename: 'Acme Notes' } },
    };
    expect(hook.resolveResourcesDir({ ...base, electronPlatformName: 'darwin' })).toBe(
      join('C:', 'out', 'Acme Notes.app', 'Contents', 'Resources'),
    );
    expect(hook.resolveResourcesDir({ ...base, electronPlatformName: 'win32' })).toBe(
      join('C:', 'out', 'resources'),
    );
  });
});
