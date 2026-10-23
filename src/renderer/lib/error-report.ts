import { hasIpcBridge } from './ipc';

/** electron-log renderer 模块类型（惰性加载后缓存） */
type LogModule = typeof import('electron-log/renderer');

/** 已加载的日志模块（null = 尚未加载完成） */
let logModule: LogModule | null = null;
/** 加载中标记（防重复触发 import） */
let loading: Promise<void> | null = null;
/** 加载完成前的待补记条目（有界：错误风暴时丢弃最旧，不无限占内存） */
const PENDING_LIMIT = 50;
const pending: { meta: Record<string, unknown>; detail: string }[] = [];

/** 惰性加载 electron-log renderer（幂等；失败静默——上报本就 best-effort） */
function ensureLogModule(): void {
  if (logModule !== null || loading !== null) {
    return;
  }
  loading = import('electron-log/renderer')
    .then((mod) => {
      logModule = mod;
      for (const item of pending) {
        mod.default.error(item.meta, item.detail);
      }
      pending.length = 0;
    })
    .catch(() => {});
}

/** 渲染层错误上报上下文（结构化字段，随日志落盘） */
export interface RendererErrorContext {
  /** 分组/来源标签（原 Sentry tags 语义） */
  readonly tags?: Readonly<Record<string, string>>;
  /** React 组件栈（错误边界场景，帮助定位出错组件） */
  readonly componentStack?: string;
}

/** 按 IPC schema 的上限截断（避免超大错误被主进程 INVALID_INPUT 整条丢弃） */
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 当前 hash 路由（无 hash 时返回 undefined；jsdom/浏览器预览不强制补） */
function currentRoute(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const hash = window.location.hash;
  return hash.startsWith('#') ? hash.slice(1) || '/' : undefined;
}

/** 标签值截断 + 条目数上限（与 shared schema 的 MAX_TAGS 对齐；route 占一个名额） */
function normalizeTags(
  tags: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  const route = currentRoute();
  if (tags === undefined && route === undefined) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {}).slice(0, 20)) {
    result[truncate(key, 64)] = truncate(value, 256);
  }
  if (route !== undefined && result['route'] === undefined) {
    result['route'] = truncate(route, 256);
  }
  return Object.fromEntries(Object.entries(result).slice(0, 20));
}

/** 把错误归一为可跨进程序列化的载荷（名称/消息/栈；非 Error 抛出物转字符串） */
function toPayload(
  error: unknown,
  context?: RendererErrorContext,
): {
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  tags?: Readonly<Record<string, string>>;
} {
  const componentStack =
    context?.componentStack !== undefined ? truncate(context.componentStack, 16_384) : undefined;
  const tags = normalizeTags(context?.tags);
  if (error instanceof Error) {
    return {
      name: truncate(error.name, 200),
      message: truncate(error.message.length > 0 ? error.message : String(error), 8_192),
      ...(error.stack !== undefined ? { stack: truncate(error.stack, 32_768) } : {}),
      ...(componentStack !== undefined ? { componentStack } : {}),
      ...(tags !== undefined ? { tags } : {}),
    };
  }
  return {
    name: 'NonErrorThrow',
    message: truncate(String(error), 8_192),
    ...(componentStack !== undefined ? { componentStack } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };
}

/** 经 telemetry:captureError 转发主进程（无 IPC 桥 / 旧 preload 时静默跳过） */
function forwardToMain(error: unknown, context?: RendererErrorContext): void {
  if (!hasIpcBridge()) {
    return;
  }
  try {
    const capture = window.api.telemetry?.captureError;
    if (typeof capture !== 'function') {
      return;
    }
    void capture(toPayload(error, context)).catch(() => {});
  } catch {
    // 遥测转发是 best-effort，不能影响本地日志与错误边界渲染
  }
}

/** 上报渲染层错误：本地 electron-log 落盘 + 主进程 Sentry/OTel 转发（双通道） */
export function reportError(error: unknown, context?: RendererErrorContext): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const meta = {
    ...(context?.tags ?? {}),
    ...(context?.componentStack !== undefined ? { componentStack: context.componentStack } : {}),
    message: '渲染层错误上报',
  };
  ensureLogModule();
  if (logModule !== null) {
    logModule.default.error(meta, detail);
  } else {
    if (pending.length >= PENDING_LIMIT) {
      pending.shift();
    }
    pending.push({ meta, detail });
  }
  forwardToMain(error, context);
}

/**
 * 安装全局错误兜底（main.tsx 顶部调用，React render 之前）
 *
 * - window error 事件：未捕获的同步异常
 * - unhandledrejection：未捕获的 Promise 拒绝（AbortError 等预期中断除外）
 */
export function initRendererErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { tags: { scope: 'window.onerror' } });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      event.preventDefault();
      return;
    }
    reportError(reason, { tags: { scope: 'unhandledrejection' } });
  });
}
