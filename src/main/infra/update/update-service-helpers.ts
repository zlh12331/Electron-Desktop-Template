import type { UpdateErrorKind } from '@code-agent/shared/main';
import { logger } from '../../utils/logger';
import type { BaselinePruneResult } from './update-cache';

/** electron-updater 日志接口的最小结构，便于测试注入。 */
export interface UpdaterLoggerLike {
  info(message?: unknown, ...params: unknown[]): void;
  warn(message?: unknown, ...params: unknown[]): void;
  error(message?: unknown, ...params: unknown[]): void;
  debug?(message?: unknown, ...params: unknown[]): void;
}

/** 差分基线一致性检查结果（skipped=无缓存目录，error=解析/修剪异常） */
export type BaselineEnsureResult = 'skipped' | BaselinePruneResult | 'error';

/**
 * 执行差分基线一致性检查（缓存目录解析与修剪均可注入，便于单测异常分支）
 *
 * @param resolveCacheDir 解析 updater 缓存目录；null 表示当前环境无从检查
 * @param prune 对缓存目录执行陈旧 blockmap 修剪
 * @returns skipped / pruned / consistent / absent / error
 */
export async function ensureBaselineConsistency(
  resolveCacheDir: () => Promise<string | null>,
  prune: (cacheDir: string) => Promise<BaselinePruneResult>,
): Promise<BaselineEnsureResult> {
  try {
    const cacheDir = await resolveCacheDir();
    if (cacheDir === null) {
      return 'skipped';
    }
    return await prune(cacheDir);
  } catch {
    return 'error';
  }
}

/** 将更新错误归类为稳定的低基数原因。 */
export function classifyUpdateError(error: unknown): UpdateErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  const code = readErrorField(error, 'code');
  const statusCode = readErrorField(error, 'statusCode');

  if (
    statusCode === 403 ||
    statusCode === 429 ||
    code === 'HTTP_ERROR_403' ||
    code === 'HTTP_ERROR_429'
  ) {
    return 'rate-limited';
  }
  if (/sha512|checksum/i.test(message)) {
    return 'checksum';
  }
  if (code === 'ENOSPC' || code === 'EDQUOT' || /ENOSPC|no space left/i.test(message)) {
    return 'disk';
  }
  if (
    /net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|socket hang up|timeout/i.test(
      message,
    ) ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT'
  ) {
    return 'network';
  }
  return 'unknown';
}

/** 将 electron-updater 的字符串/数组说明归一为可展示文本。 */
export function toReleaseNotes(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const note = Reflect.get(item, 'note');
          return typeof note === 'string' ? note.trim() : '';
        }
        return '';
      })
      .filter((part) => part !== '');
    return parts.length === 0 ? null : parts.join('\n\n');
  }
  return null;
}

function readErrorField(error: unknown, field: string): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  return Reflect.get(error, field) as unknown;
}

function toLogText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 把 updater 日志转入主进程结构化 logger，异常值不抛出。 */
export function createUpdaterLogger(): UpdaterLoggerLike {
  const forward = (level: 'info' | 'warn' | 'error' | 'debug', args: readonly unknown[]): void => {
    logger[level]({ scope: 'auto-updater' }, args.map((arg) => toLogText(arg)).join(' '));
  };
  return {
    info: (message, ...params) => forward('info', [message, ...params]),
    warn: (message, ...params) => forward('warn', [message, ...params]),
    error: (message, ...params) => forward('error', [message, ...params]),
    debug: (message, ...params) => forward('debug', [message, ...params]),
  };
}
