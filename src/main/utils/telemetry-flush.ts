// telemetry-flush.ts：命名冲刷注册表隔离各 SDK，避免遥测挂住致命退出。
type FlushImpl = (timeoutMs: number) => Promise<void> | void;
type FlushName = 'sentry' | 'otel';

const flushers = new Map<FlushName, { readonly impl: FlushImpl }>();

/** 注册命名冲刷并返回注销函数；旧注册的清理不能移除替代实现。 */
export function registerTelemetryFlush(name: FlushName, impl: FlushImpl): () => void {
  const entry = { impl };
  flushers.set(name, entry);
  return () => {
    if (flushers.get(name) === entry) {
      flushers.delete(name);
    }
  };
}

async function runFlush(impl: FlushImpl, timeoutMs: number): Promise<void> {
  try {
    await impl(timeoutMs);
  } catch {
    // 单个 SDK 同步抛错或异步拒绝不能跳过其他信号。
  }
}

/** 并行冲刷所有注册项且共享总时限；未注册返回 null 以保留退出快速路径。 */
export function flushTelemetryOnFatal(timeoutMs = 1_500): Promise<void> | null {
  if (flushers.size === 0) {
    return null;
  }
  const budget = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 1_500;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budget);
  });
  const pending = [...flushers.values()].map(({ impl }) => runFlush(impl, budget));
  return Promise.race([Promise.all(pending).then(() => {}), deadline]).finally(() => {
    clearTimeout(timer);
  });
}
