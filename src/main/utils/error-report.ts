// error-report.ts：错误上报单一出口——主进程一切异常经这里落本地日志并转发已注册的后端
// 本地优先：日志始终写（诊断包可离线排障）；Sentry 未配置时 sink 未注册，capture 为 no-op
// 渲染层对应物在 src/renderer/lib/error-report.ts（经 telemetry:captureError IPC 转发）
import { logger } from './logger';

/** 上报附加上下文：tags 进结构化字段；componentStack 供渲染层 React 组件栈（转发场景） */
export interface ErrorReportContext {
  readonly tags?: Readonly<Record<string, string>>;
  readonly componentStack?: string;
}

/** 错误捕获 sink：Sentry 初始化成功后注册（反转 utils → infra 的依赖方向） */
export interface ErrorCaptureSink {
  captureError(error: unknown, context?: ErrorReportContext): void;
  captureMessage(message: string, level: 'error' | 'warning'): void;
}

let captureSink: ErrorCaptureSink | null = null;

/** 注册/注销错误捕获后端（Sentry 关闭时传 null） */
export function setErrorCaptureSink(sink: ErrorCaptureSink | null): void {
  captureSink = sink;
}

/** 上报异常（统一 message 前缀「错误上报」，便于日志检索聚合；Sentry 侧保留原始错误） */
export function reportError(error: unknown, context?: ErrorReportContext): void {
  logger.error(
    {
      ...(context?.tags ?? {}),
      ...(context?.componentStack !== undefined ? { componentStack: context.componentStack } : {}),
    },
    '错误上报',
    error,
  );
  captureSink?.captureError(error, context);
}

/** 上报一条消息（无异常对象时用；warning 级用于「疑似问题但不致命」场景，如内存增长） */
export function reportMessage(message: string, level: 'error' | 'warning' = 'error'): void {
  if (level === 'warning') {
    logger.warn({ scope: 'error-report' }, message);
  } else {
    logger.error({ scope: 'error-report' }, message);
  }
  captureSink?.captureMessage(message, level);
}
