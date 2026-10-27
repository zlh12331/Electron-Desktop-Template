import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import '@/i18n';

// reportError 会惰性 import electron-log；测试进程退出时 import 未完成会触发
// "onUserConsoleLog pending" 的 teardown 竞态（threads 池在 ARM runner 上偶发）
vi.mock('electron-log/renderer', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

type MockApi = {
  // biome-ignore lint/suspicious/noExplicitAny: 测试环境用 any 简化类型
  [domain: string]: any;
};

/** 重建空骨架（模块加载与 afterEach 共用）：避免复用单例导致注入域残留到下一测试 */
function createEmptyApi(): MockApi {
  return {
    app: {
      getLoginItemSettings: async () => ({
        data: { openAtLogin: false, supported: false, requiresApproval: false },
      }),
      setLoginItemSettings: async () => ({
        data: { openAtLogin: false, supported: false, requiresApproval: false },
      }),
      subscribeLoginItemChanged: () => () => {},
      subscribeDeepLink: () => () => {},
      takePendingDeepLink: async () => ({ data: { payload: null } }),
    },
    settings: {
      subscribeChanged: () => () => {},
    },
    dialog: {},
    devtools: {},
    logs: {},
    telemetry: {
      captureError: async () => ({ data: { accepted: true } }),
      reportWebVitals: async () => ({ data: { accepted: 0 } }),
      rendererReady: async () => ({ data: { accepted: true } }),
      getStatus: async () => ({
        data: {
          level: 'off',
          configuredLevel: 'off',
          restartRequired: false,
          sentry: {
            enabled: false,
            initialized: false,
            reason: 'telemetry-off',
            release: null,
            environment: null,
          },
          otel: {
            enabled: false,
            tracing: false,
            metrics: false,
            logs: false,
            endpointConfigured: false,
          },
          health: {
            traces: {
              attempts: 0,
              failures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastError: null,
            },
            metrics: {
              attempts: 0,
              failures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastError: null,
            },
            logs: {
              attempts: 0,
              failures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastError: null,
            },
            sampledLogs: 0,
            rateLimitedLogs: 0,
            suppressedErrors: 0,
            lastDropAt: null,
          },
        },
      }),
      testConnection: async () => ({
        data: {
          sentry: { configured: false, valid: false, message: '未配置 DSN' },
          otlp: { checked: false, reason: 'no-endpoint', message: '', results: [] },
        },
      }),
    },
    backup: {},
    proxy: {
      test: async () => ({ data: { ok: false, kind: 'not-applicable' } }),
      clearAuth: async () => ({ data: { ok: true } }),
    },
    invalidation: {
      subscribeDomains: () => () => {},
    },
    update: {
      check: async () => ({ data: { status: 'checking' } }),
      install: async () => ({ data: { ok: true } }),
      cancel: async () => ({ data: { ok: true } }),
      getStatus: async () => ({ data: { phase: 'idle' } }),
      getCacheInfo: async () => ({ data: { path: null, bytes: 0, fileCount: 0 } }),
      clearCache: async () => ({ data: { path: null, bytes: 0, fileCount: 0 } }),
      subscribeStatus: () => () => {},
    },
  };
}

Object.defineProperty(window, 'api', {
  value: createEmptyApi(),
  writable: true,
  configurable: true,
});

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

declare global {
  interface Window {
    // biome-ignore lint/style/useNamingConvention: 与 lib.dom ResizeObserver 同名
    ResizeObserver: typeof MockResizeObserver;
  }
}

window.ResizeObserver = MockResizeObserver;

window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Radix Select（下拉）在 jsdom 中会调用 Pointer Capture API；jsdom 未实现这些方法，
// 缺了会让 open 交互直接抛错。测试语义不需要真实捕获，补空实现即可。
if (typeof window.HTMLElement.prototype.hasPointerCapture !== 'function') {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
}
if (typeof window.HTMLElement.prototype.setPointerCapture !== 'function') {
  window.HTMLElement.prototype.setPointerCapture = () => {};
}
if (typeof window.HTMLElement.prototype.releasePointerCapture !== 'function') {
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}

globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

window.matchMedia =
  window.matchMedia ??
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

class MockIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

import { afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'api', {
    value: createEmptyApi(),
    writable: true,
    configurable: true,
  });
});
