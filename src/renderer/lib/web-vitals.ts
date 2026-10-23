// web-vitals.ts：渲染层 Core Web Vitals 采集与批量上报（经 telemetry:reportWebVitals）
// 边界：只在有 IPC 桥时启动；无后端/遥测非 full 时主进程返回 accepted=0，渲染层不重试
import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';

import { hasIpcBridge } from './ipc';

const FLUSH_DELAY_MS = 5_000;

const MAX_BATCH = 10;

interface WebVitalPayload {
  readonly name: Metric['name'];
  readonly value: number;
  readonly rating?: Metric['rating'];
  readonly delta?: number;
  readonly navigationType?: string;
}

let queue: WebVitalPayload[] = [];

let timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** 立即发送当前批次（pagehide/visibilitychange 与定时器共用；失败即丢弃，不重试） */
function flush(): void {
  clearTimer();
  if (queue.length === 0) {
    return;
  }
  const batch = queue;
  queue = [];
  try {
    const report = window.api.telemetry?.reportWebVitals;
    if (typeof report !== 'function') {
      return;
    }
    void report({ metrics: batch }).catch(() => {});
  } catch {
    // 上报失败不影响页面生命周期
  }
}

function enqueue(metric: Metric): void {
  queue.push({
    name: metric.name,
    value: metric.value,
    ...(metric.rating !== undefined ? { rating: metric.rating } : {}),
    ...(metric.delta !== undefined ? { delta: metric.delta } : {}),
    ...(metric.navigationType !== undefined ? { navigationType: metric.navigationType } : {}),
  });
  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  if (timer === null) {
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

/**
 * 启动 Web Vitals 采集（main.tsx 在 React 渲染前调用一次）
 *
 * 无 IPC 桥（浏览器预览 / E2E web）或旧 preload 缺少 telemetry 域时完全不注册监听。
 */
export function initWebVitals(): void {
  if (!hasIpcBridge()) {
    return;
  }
  if (typeof window.api.telemetry?.reportWebVitals !== 'function') {
    return;
  }
  onCLS(enqueue);
  onFCP(enqueue);
  onINP(enqueue);
  onLCP(enqueue);
  onTTFB(enqueue);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
}
