// after-pack-prune.cjs：electron-builder afterPack 钩子——删除运行时不需要的原生产物。
//
// 为什么在打包后做：electron-builder 的 files 规则能排除整包/整目录，但原生模块的
// 预编译矩阵与调试符号需要按「目标平台 + 目标架构」保留唯一可加载文件；用钩子可以在
// 正确的上下文里做，且不必为 win/mac/linux 各写一份 files 规则。
//
// 安全性：better-sqlite3 v13 的 lib/binding.js 优先加载 prebuilds/<platform>-<arch>.node；
// Sentry 原生栈回溯在 Electron 下加载 build/Release/stack-trace.node。两者之外的
// .node/.iobj/.ipdb/.tlog/源码都不参与运行。

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** builder-util 的 Arch 枚举（避免钩子依赖构建期包） */
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

/** 递归统计目录大小（忽略符号链接；仅用于日志） */
function sizeOf(target) {
  let total = 0;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    return 0;
  }
  if (!stat.isDirectory()) {
    return stat.size;
  }
  for (const entry of fs.readdirSync(target)) {
    total += sizeOf(path.join(target, entry));
  }
  return total;
}

/** 删除文件/目录（不存在时静默） */
function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/** 删除目录内除白名单外的所有条目 */
function pruneChildren(dir, keep) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir)) {
    if (!keep.has(entry)) {
      remove(path.join(dir, entry));
    }
  }
}

/** 应用资源目录（macOS 在 .app/Contents/Resources，其余在 <out>/resources） */
function resolveResourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    return path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

/**
 * 裁剪 better-sqlite3：只保留当前平台/架构的 prebuild，删除源码与编译工程文件
 *
 * @param {string} nodeModules app.asar.unpacked/node_modules
 * @param {string} platform win32 / darwin / linux
 * @param {string} arch x64 / arm64 / ...
 * @returns {number} 释放的字节数
 */
function pruneBetterSqlite3(nodeModules, platform, arch) {
  const root = path.join(nodeModules, 'better-sqlite3');
  if (!fs.existsSync(root)) {
    return 0;
  }
  const before = sizeOf(root);
  for (const rel of ['deps', 'src', 'build']) {
    remove(path.join(root, rel));
  }
  remove(path.join(root, 'binding.gyp'));
  const keep = new Set([`${platform}-${arch}.node`]);
  if (platform === 'linux') {
    // glibc/musl 两种运行时共用同一 AppImage 构建产物，保留同架构的两份
    keep.add(`linuxmusl-${arch}.node`);
  }
  if (arch === 'universal') {
    keep.add(`${platform}-x64.node`);
    keep.add(`${platform}-arm64.node`);
  }
  pruneChildren(path.join(root, 'prebuilds'), keep);
  return Math.max(0, before - sizeOf(root));
}

/**
 * 裁剪 Sentry 原生栈回溯：Electron 使用 build/Release/stack-trace.node，
 * 其余 ABI/平台预编译与 MSVC 调试符号全部删除
 *
 * @param {string} nodeModules app.asar.unpacked/node_modules
 * @returns {number} 释放的字节数
 */
function pruneSentryNative(nodeModules) {
  const root = path.join(nodeModules, '@sentry', 'node-native-stacktrace');
  if (!fs.existsSync(root)) {
    return 0;
  }
  const before = sizeOf(root);
  remove(path.join(root, 'bin'));
  const lib = path.join(root, 'lib');
  if (fs.existsSync(lib)) {
    for (const entry of fs.readdirSync(lib)) {
      if (entry.startsWith('stack-trace-') && entry.endsWith('.node')) {
        remove(path.join(lib, entry));
      }
    }
  }
  const release = path.join(root, 'build', 'Release');
  if (fs.existsSync(path.join(release, 'stack-trace.node'))) {
    pruneChildren(path.join(root, 'build'), new Set(['Release']));
    pruneChildren(release, new Set(['stack-trace.node']));
  }
  return Math.max(0, before - sizeOf(root));
}

/**
 * afterPack 入口：按目标平台裁剪原生载荷
 *
 * @param {import('app-builder-lib').AfterPackContext} context electron-builder 上下文
 */
async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch] ?? 'x64';
  const resources = resolveResourcesDir(context);
  const nodeModules = path.join(resources, 'app.asar.unpacked', 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('[after-pack-prune] 无 app.asar.unpacked，跳过');
    return;
  }
  const sqlite = pruneBetterSqlite3(nodeModules, platform, arch);
  const sentry = pruneSentryNative(nodeModules);
  const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
  console.log(
    `[after-pack-prune] ${platform}-${arch}：better-sqlite3 -${mb(sqlite)}，sentry-native -${mb(sentry)}`,
  );
}

module.exports = afterPack;
module.exports.pruneBetterSqlite3 = pruneBetterSqlite3;
module.exports.pruneSentryNative = pruneSentryNative;
module.exports.resolveResourcesDir = resolveResourcesDir;
