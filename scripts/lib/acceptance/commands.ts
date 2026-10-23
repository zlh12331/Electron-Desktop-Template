// scripts/lib/acceptance/commands.ts
// 子进程执行层：统一 pnpm 定位、环境变量清洗、退出码与超时处理。
// 验收脚本会跑 install / E2E / build 等长任务，输出直接继承终端。

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { basename } from 'node:path';

/** 验收期间必须清除的环境变量（防止本机 dev/E2E 配置泄漏进副本） */
export const ACCEPTANCE_ENV_STRIP_KEYS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_OVERRIDE_DIST_PATH',
  'APP_DEV_UPDATE',
  'APP_USER_DATA',
  'APP_DEBUG_PORT',
  'ELECTRON_RENDERER_URL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
] as const;

/** 子进程执行选项 */
export interface RunOptions {
  /** true = 捕获输出（用于幂等断言）；默认继承终端 */
  readonly capture?: boolean;
  /** 超时（毫秒）；0/缺省 = 不设上限 */
  readonly timeoutMs?: number;
  /** 显式环境变量；缺省继承 process.env */
  readonly env?: NodeJS.ProcessEnv;
}

/** 命令输出（capture=false 时为空串） */
export interface CommandOutput {
  /** 标准输出 */
  readonly stdout: string;
  /** 标准错误 */
  readonly stderr: string;
}

/**
 * 定位 pnpm 可执行文件
 *
 * pnpm run / pnpm exec 会注入 npm_execpath（本机为 pnpm.exe）；直接 spawn 该路径
 * 可避免 Windows 上 `.cmd` + shell 的引号问题。未注入时回退 PATH 中的 pnpm。
 *
 * @param execPath npm_execpath（测试注入）
 * @param platform 平台（测试注入）
 */
export function resolvePnpmCommand(
  execPath: string | undefined = process.env['npm_execpath'],
  platform: NodeJS.Platform = process.platform,
): string {
  if (execPath !== undefined && /pnpm/i.test(basename(execPath))) {
    return execPath;
  }
  return platform === 'win32' ? 'pnpm.exe' : 'pnpm';
}

/**
 * 复制环境变量并删除指定键（不修改入参）
 *
 * @param env 源环境变量
 * @param keys 要删除的键
 */
export function cleanEnv(
  env: NodeJS.ProcessEnv = process.env,
  keys: readonly string[] = ACCEPTANCE_ENV_STRIP_KEYS,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

/**
 * 执行一次命令；非零退出码/启动失败/超时均抛错
 *
 * @param label 日志名称
 * @param command 可执行文件
 * @param args 参数数组
 * @param cwd 工作目录
 * @param options 执行选项
 */
export function runCommand(
  label: string,
  command: string,
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): CommandOutput {
  const result = spawnSync(command, [...args], {
    cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: options.timeoutMs ?? 0,
  });
  if (result.error !== undefined) {
    throw new Error(`[${label}] 启动失败：${result.error.message}`);
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.status !== 0) {
    const detail = stderr.trim() !== '' ? `\n${stderr.trim()}` : '';
    throw new Error(`[${label}] 退出码 ${String(result.status)}${detail}`);
  }
  return { stdout, stderr };
}

/**
 * 执行一个 pnpm 脚本或子命令
 *
 * @param args pnpm 参数（如 ['install', '--frozen-lockfile']）
 * @param cwd 工作目录
 * @param options 执行选项
 */
export function runPnpm(
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): CommandOutput {
  return runCommand(`pnpm ${args[0] ?? ''}`, resolvePnpmCommand(), args, cwd, options);
}

/**
 * 断言端口当前空闲（E2E 的 webServer 会复用 5173，占用时连到错误项目）
 *
 * @param port 端口
 * @throws Error 端口被占用时
 */
export async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `端口 ${port} 已被占用（${error.code ?? error.message}）：请先关闭现有 dev server 再验收`,
        ),
      );
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}
