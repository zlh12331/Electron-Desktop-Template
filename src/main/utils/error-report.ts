// error-report.ts：错误上报单一出口——主进程一切异常经这里落本地日志并转发已注册的后端
// 本地优先：日志始终写（诊断包可离线排障）；Sentry 未配置时 sink 未注册，capture 为 no-op
// 渲染层对应物在 src/renderer/lib/error-report.ts（经 telemetry:captureError IPC 转发）
import { logger } from './logger';

/** 上报附加上下文：tags 进结构化字段与后端标签；fields 只进本地日志；componentStack 供渲染层组件栈 */
export interface ErrorReportContext {
  readonly tags?: Readonly<Record<string, string>>;
  /** 仅本地日志的附加结构化字段（路径等排障细节，不进后端 tags） */
  readonly fields?: Readonly<Record<string, unknown>>;
  /** 本地日志正文（缺省「错误上报」；Sentry 仍保留原始错误） */
  readonly message?: string;
  readonly componentStack?: string;
}

/** 远端错误上下文不公开本地字段和日志正文，避免后端实现误用。 */
interface RemoteErrorContext {
  readonly tags?: Readonly<Record<string, string>>;
  readonly componentStack?: string;
}

/** 错误捕获 sink：Sentry 初始化成功后注册（反转 utils → infra 的依赖方向） */
export interface ErrorCaptureSink {
  captureError(error: unknown, context?: RemoteErrorContext): void;
  captureMessage(message: string, level: 'error' | 'warning'): void;
}

let captureSink: ErrorCaptureSink | null = null;

/** 注册/注销错误捕获后端（Sentry 关闭时传 null） */
export function setErrorCaptureSink(sink: ErrorCaptureSink | null): void {
  captureSink = sink;
}

/** 上报异常（本地日志统一出口；message 可给排障正文，Sentry 侧保留原始错误） */
export function reportError(error: unknown, context?: ErrorReportContext): void {
  logger.error(
    {
      ...(context?.fields ?? {}),
      ...(context?.tags ?? {}),
      ...(context?.componentStack !== undefined ? { componentStack: context.componentStack } : {}),
    },
    context?.message ?? '错误上报',
    error,
    {
      context: {
        ...(context?.tags ?? {}),
        ...(context?.componentStack !== undefined
          ? { componentStack: context.componentStack }
          : {}),
      },
      message: '错误上报',
    },
  );
  // 两个远端出口都只接收 tags 与组件栈，本地详情不能经 LogSink 绕过边界。
  try {
    captureSink?.captureError(
      error,
      context === undefined
        ? undefined
        : {
            ...(context.tags !== undefined ? { tags: context.tags } : {}),
            ...(context.componentStack !== undefined
              ? { componentStack: context.componentStack }
              : {}),
          },
    );
  } catch {
    // SDK 失败不能制造二次异常。
  }
}

/** 上报一条消息（无异常对象时用；warning 级用于「疑似问题但不致命」场景，如内存增长） */
export function reportMessage(message: string, level: 'error' | 'warning' = 'error'): void {
  if (level === 'warning') {
    logger.warn({ scope: 'error-report' }, message);
  } else {
    logger.error({ scope: 'error-report' }, message);
  }
  try {
    captureSink?.captureMessage(message, level);
  } catch {
    // SDK 失败不能制造二次异常。
  }
}
