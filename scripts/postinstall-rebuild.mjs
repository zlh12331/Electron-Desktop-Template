import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Electron 包不再自带 postinstall，必须显式安装二进制，不能只完成原生模块重编。
const electronDir = join(process.cwd(), 'node_modules', 'electron');
const installation = spawnSync(process.execPath, [join(electronDir, 'install.js')], {
  stdio: 'inherit',
});
if (installation.status !== 0) {
  console.error('[postinstall] Electron 二进制安装失败');
  process.exit(installation.status ?? 1);
}
const pathFile = join(electronDir, 'path.txt');
const executable = existsSync(pathFile) ? readFileSync(pathFile, 'utf8').trim() : '';
const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || join(electronDir, 'dist');
if (!executable || !existsSync(join(distDir, executable))) {
  console.error('[postinstall] Electron 二进制缺失，请重新运行 pnpm install');
  process.exit(1);
}

if (process.env['SKIP_ELECTRON_REBUILD'] === '1') {
  console.log('[postinstall] SKIP_ELECTRON_REBUILD=1，跳过原生模块重编译');
  process.exit(0);
}

console.log('[postinstall] 重编译原生模块为 Electron ABI（better-sqlite3）...');
const electronRebuildCli = join(
  process.cwd(),
  'node_modules',
  '@electron',
  'rebuild',
  'lib',
  'cli.js',
);
const result = spawnSync(process.execPath, [electronRebuildCli, '-f', '-w', 'better-sqlite3'], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error('[postinstall] 原生模块重编译失败（better-sqlite3 未编译为 Electron ABI）');
  console.error(
    '[postinstall] 直接启动会因 NODE_MODULE_VERSION 不匹配而失败。请修复本机构建工具链后重新执行 pnpm install；' +
      '确需跳过时显式设置 SKIP_ELECTRON_REBUILD=1。',
  );
  process.exit(result.status ?? 1);
}
console.log('[postinstall] 原生模块重编译完成');
