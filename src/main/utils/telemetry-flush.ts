// telemetry-flush.ts：进程致命退出前的遥测冲刷注册表（避免 logger 静态依赖 Sentry SDK）
// 边界：只保存一个回调；Sentry 初始化成功后注册，未启用时 flush 为 no-op
type FlushImpl = (timeoutMs: number) => Promise<void>;

let flushImpl: FlushImpl | null = null;

/** 注册/覆盖致命退出前的冲刷实现（Sentry 初始化成功后调用） */
export function registerTelemetryFlush(impl: FlushImpl): void {
  flushImpl = impl;
}

/**
 * 致命退出前触发一次冲刷
 *
 * @returns 可用于等待的 Promise；未注册时为 null（调用方直接走快速退出）
 */
export function flushTelemetryOnFatal(timeoutMs = 1_500): Promise<void> | null {
  if (flushImpl === null) {
    return null;
  }
  return flushImpl(timeoutMs).catch(() => {});
}
