// logger.ts：主进程日志——electron-log 封装（文件 + console 双通道）、全局异常处理器、崩溃标记
// 边界：渲染层日志经 electron-log/renderer 转发到这里落盘；错误出口统一走 error-report.ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { flushTelemetryOnFatal } from './telemetry-flush';

// 测试环境日志改写进系统临时目录，避免污染 userData / 触发打包路径断言
const IS_TEST_ENV = process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
if (IS_TEST_ENV) {
  log.transports.file.resolvePathFn = () => join(tmpdir(), 'code-agent-test-logs', 'main.log');
}

/** 结构化日志上下文：traceId/channel 之外的键自由扩展（进 JSON 字段） */
interface LogContext {
  readonly traceId?: string;
  readonly channel?: string;
  readonly [key: string]: unknown;
}

/** 应用日志初始化（whenReady 启动序列首个调用；级别按打包态分级） */
export function initLogger(): void {
  log.transports.file.level = app.isPackaged ? 'info' : 'debug';
  log.transports.console.level = app.isPackaged ? false : 'debug';

  log.transports.file.fileName = 'main.log';
  log.transports.file.maxSize = 10 * 1024 * 1024;

  log.transports.file.sync = false;

  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  log.transports.console.format = '{level} {text}';

  log.initialize();
}

/** 应用用户选择的详细日志级别（verbose → debug；否则沿用打包态 info / dev debug） */
export function applyLogLevel(verbose: boolean): void {
  log.transports.file.level = verbose ? 'debug' : app.isPackaged ? 'info' : 'debug';
}

/** 显式区分本地排障详情与上行上下文，避免旁路隐式复制本地字段。 */
export interface RemoteLog {
  readonly context: LogContext;
  readonly message: string;
}

/** 日志接口（结构化 context 前置 + message；error 可附原始错误） */
export interface Logger {
  info(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  error(context: LogContext, message: string, error?: unknown, remote?: RemoteLog): void;
  debug(context: LogContext, message: string): void;
}

/** 日志级别（与 electron-log 对齐） */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志旁路 sink：telemetry 层注册后把日志导出到 OTel
 *
 * 放在 utils 侧反转依赖方向——logger 不认识 telemetry，infra/telemetry 依赖 logger。
 */
export type LogSink = (
  level: LogLevel,
  context: LogContext,
  message: string,
  error?: unknown,
) => void;

let logSink: LogSink | null = null;

/** 注册/注销日志旁路（OTel 初始化时注册；未注册时日志只落 electron-log） */
export function setLogSink(sink: LogSink | null): void {
  logSink = sink;
}

function emitToSink(level: LogLevel, context: LogContext, message: string, error?: unknown): void {
  try {
    if (error === undefined) {
      logSink?.(level, context, message);
    } else {
      logSink?.(level, context, message, error);
    }
  } catch {
    // 旁路失败不能反向阻断本地错误处理。
  }
}

function writeLocalLog(
  level: LogLevel,
  context: LogContext,
  message: string,
  error?: unknown,
): void {
  try {
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(context)) {
      const descriptor = Object.getOwnPropertyDescriptor(context, key);
      Object.defineProperty(fields, key, {
        value:
          descriptor !== undefined && 'value' in descriptor ? descriptor.value : '[Unserializable]',
        enumerable: true,
      });
    }
    log[level]({
      ...fields,
      message,
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    });
  } catch {
    // 不可信对象或 transport 失败时仍尝试保存最小证据。
    try {
      log[level]({ message, error: '[Unserializable log entry]' });
    } catch {
      // 日志设施失效时不制造二次异常。
    }
  }
}

/** 全局唯一 logger 实例，本地先写且与远端 sink 故障隔离。 */
export const logger: Logger = {
  info(context: LogContext, message: string): void {
    writeLocalLog('info', context, message);
    emitToSink('info', context, message);
  },
  warn(context: LogContext, message: string): void {
    writeLocalLog('warn', context, message);
    emitToSink('warn', context, message);
  },
  error(context: LogContext, message: string, error?: unknown, remote?: RemoteLog): void {
    writeLocalLog('error', context, message, error);
    emitToSink('error', remote?.context ?? context, remote?.message ?? message, error);
  },
  debug(context: LogContext, message: string): void {
    writeLocalLog('debug', context, message);
    emitToSink('debug', context, message);
  },
};

function readErrorField(error: Error, key: 'name' | 'message' | 'stack' | 'cause'): unknown {
  try {
    return error[key];
  } catch {
    return '[Unserializable]';
  }
}

function serializeError(
  error: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): Record<string, unknown> {
  if (depth >= 8) {
    return { value: '[Truncated]' };
  }
  try {
    if (!(error instanceof Error)) {
      return { value: String(error) };
    }
    if (seen.has(error)) {
      return { value: '[Circular]' };
    }
    seen.add(error);
    const result: Record<string, unknown> = {};
    for (const key of ['name', 'message', 'stack'] as const) {
      const value = readErrorField(error, key);
      result[key] = typeof value === 'string' || value === undefined ? value : '[Unserializable]';
    }
    const cause = readErrorField(error, 'cause');
    if (cause !== undefined) {
      result['cause'] = serializeError(cause, seen, depth + 1);
    }
    return result;
  } catch {
    return { value: '[Unserializable]' };
  }
}

let fatalErrorHandled = false;

/**
 * 等待 electron-log 异步写队列排空（退出善后链最后一步，防崩溃前最后几条日志丢失）
 *
 * electron-log 无公开 flush API，只能窥探 file transport 的内部队列轮询，300ms 内不排空就放弃
 */
export async function flushPendingLogs(timeoutMs = 300): Promise<void> {
  const file = (
    log.transports.file as unknown as {
      getFile?(): { asyncWriteQueue: string[]; hasActiveAsyncWriting: boolean } | undefined;
    }
  ).getFile?.();
  if (file === undefined) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (file.asyncWriteQueue.length > 0 || file.hasActiveAsyncWriting)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 致命异常给本地 300ms、遥测 1.5s、退出 2s 兜底；Promise 局部失败只记录不退出。 */
export function registerGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    if (fatalErrorHandled) {
      return;
    }
    fatalErrorHandled = true;
    let exited = false;
    const exit = (): void => {
      if (!exited) {
        exited = true;
        clearTimeout(forceExit);
        app.exit(1);
      }
    };
    // 在接触错误 getter、文件和 SDK 前安装最后一道退出兜底。
    const forceExit = setTimeout(exit, 2_000);
    forceExit.unref();
    logger.error({}, '全局未捕获异常 uncaughtException', error);
    writeCrashMarker(error);
    const localFlush = flushPendingLogs(300);
    const telemetryFlush = flushTelemetryOnFatal(1_500);
    const timeout = setTimeout(exit, telemetryFlush === null ? 300 : 1_500);
    timeout.unref();
    void Promise.allSettled([localFlush, telemetryFlush]).then(() => {
      clearTimeout(timeout);
      exit();
    });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({}, '全局未处理的 Promise 拒绝 unhandledRejection', reason);
  });
}

// 崩溃标记（.crash-marker）：启动序列 recoverFromCrash 检测到它才走「上次异常退出」分支，
// 清除时机在恢复完成后（finally），保证强杀/断电下次启动仍能被识别
function getCrashMarkerPath(): string {
  return join(app.getPath('userData'), '.crash-marker');
}

/** 上次异常退出的崩溃标记（启动恢复时上报用） */
export interface CrashMarker {
  readonly timestamp: number;
  readonly message: string;
  readonly stack?: string;
}

function writeCrashMarker(error: Error): void {
  try {
    const markerPath = getCrashMarkerPath();
    mkdirSync(dirname(markerPath), { recursive: true });
    const marker: CrashMarker = {
      timestamp: Date.now(),
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
    };
    writeFileSync(markerPath, JSON.stringify(marker), 'utf8');
    logger.info({ markerPath }, '已写入崩溃标记');
  } catch (writeError) {
    logger.error({}, '崩溃标记写入失败', writeError);
  }
}

export function clearCrashMarker(): void {
  try {
    const markerPath = getCrashMarkerPath();
    if (existsSync(markerPath)) {
      unlinkSync(markerPath);
      logger.info({ markerPath }, '已清除崩溃标记');
    }
  } catch (error) {
    logger.error({ error: String(error) }, '崩溃标记清除失败');
  }
}

/** 读取崩溃标记（文件缺失/损坏/字段非法返回 null；不删除文件） */
export function readCrashMarker(): CrashMarker | null {
  try {
    const content = readFileSync(getCrashMarkerPath(), 'utf8');
    const parsed = JSON.parse(content) as Partial<CrashMarker>;
    if (
      typeof parsed.timestamp !== 'number' ||
      !Number.isFinite(parsed.timestamp) ||
      typeof parsed.message !== 'string'
    ) {
      return null;
    }
    return {
      timestamp: parsed.timestamp,
      message: parsed.message,
      ...(typeof parsed.stack === 'string' ? { stack: parsed.stack } : {}),
    };
  } catch {
    return null;
  }
}
