// sentry-debug-files.ts：上传 Electron 打包目录里的原生调试符号（可选，默认关闭）
// 用法：SENTRY_UPLOAD_DEBUG_FILES=1 pnpm sentry:debug-files（CI 在打包后调用）
// 说明：--include-sources 会连带上传本地源文件；只对原生崩溃符号化有用，体积大，故默认不传

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { resolveSentryUploadConfig } from './lib/sentry-upload';

const root = join(import.meta.dirname, '..');

if (process.env['SENTRY_UPLOAD_DEBUG_FILES'] !== '1') {
  console.log('[sentry-debug-files] 跳过：未设置 SENTRY_UPLOAD_DEBUG_FILES=1');
  process.exit(0);
}

const config = resolveSentryUploadConfig(process.env, 'unused', '0.0.0', join(root, 'release'));
if (config.skipReason !== null) {
  console.log(`[sentry-debug-files] 跳过：${config.skipReason}`);
  process.exit(0);
}

const candidates = [
  'release/win-unpacked',
  'release/mac',
  'release/mac-arm64',
  'release/linux-unpacked',
  'release/linux-x64-unpacked',
  'release/linux-arm64-unpacked',
];
const dirs = candidates.map((candidate) => join(root, candidate)).filter((dir) => existsSync(dir));

if (dirs.length === 0) {
  console.log('[sentry-debug-files] 跳过：未找到 electron-builder 解包目录');
  process.exit(0);
}

const cliPath = createRequire(import.meta.url).resolve('@sentry/cli/bin/sentry-cli');
const env: NodeJS.ProcessEnv = { ...process.env };
env['SENTRY_AUTH_TOKEN'] = config.authToken;
env['SENTRY_ORG'] = config.org;
env['SENTRY_PROJECT'] = config.project;

for (const dir of dirs) {
  console.log(`[sentry-debug-files] 上传 ${dir}`);
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'debug-files',
      'upload',
      '--include-sources',
      '--org',
      config.org,
      '--project',
      config.project,
      dir,
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (result.error !== undefined) {
    console.error(`[sentry-debug-files] 启动失败：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[sentry-debug-files] 上传失败（退出码 ${String(result.status)}）：${dir}`);
    process.exit(result.status ?? 1);
  }
}
console.log('[sentry-debug-files] 完成');
