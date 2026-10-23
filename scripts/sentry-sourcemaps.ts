// sentry-sourcemaps.ts：构建后把 out/ 的 JS 注入 debug id 并上传 Sentry（未配置凭据时显式跳过）
// 用法：pnpm sentry:sourcemaps（build:instrumented 在 electron-builder 之前调用）
// 凭据：SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT；release 默认 {可执行名}@{版本}

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { buildSourcemapCommands, resolveSentryUploadConfig } from './lib/sentry-upload';

const root = join(import.meta.dirname, '..');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const appConfig = readJson<{ executableName: string }>(join(root, 'app.config.json'));
const pkg = readJson<{ version: string }>(join(root, 'package.json'));
const outDir = join(root, 'out');

const config = resolveSentryUploadConfig(
  process.env,
  appConfig.executableName,
  pkg.version,
  outDir,
);

if (config.skipReason !== null) {
  console.log(`[sentry-sourcemaps] 跳过：${config.skipReason}`);
  process.exit(0);
}
if (!existsSync(outDir)) {
  console.error(`[sentry-sourcemaps] 产物目录不存在：${outDir}（先执行 pnpm build）`);
  process.exit(1);
}

const cliPath = createRequire(import.meta.url).resolve('@sentry/cli/bin/sentry-cli');
const env: NodeJS.ProcessEnv = { ...process.env };
env['SENTRY_AUTH_TOKEN'] = config.authToken;
env['SENTRY_ORG'] = config.org;
env['SENTRY_PROJECT'] = config.project;

console.log(`[sentry-sourcemaps] release=${config.release} out=${outDir}`);

for (const args of buildSourcemapCommands(config)) {
  const label = args.slice(0, 2).join(' ');
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error !== undefined) {
    console.error(`[sentry-sourcemaps] ${label} 启动失败：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    // releases new/finalize 在重跑同一版本时会报「已存在/已 finalize」，不应阻断构建；
    // sourcemaps inject/upload 失败则必须阻断，避免发出无法符号化的版本
    if (args[0] === 'releases') {
      console.warn(
        `[sentry-sourcemaps] ${label} 返回 ${String(result.status)}（重跑同版本可忽略）`,
      );
      continue;
    }
    console.error(`[sentry-sourcemaps] ${label} 失败（退出码 ${String(result.status)}）`);
    process.exit(result.status ?? 1);
  }
}
console.log('[sentry-sourcemaps] 完成');
