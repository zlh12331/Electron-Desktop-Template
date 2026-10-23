// sentry.ts：Sentry 主进程接入（错误聚合 / 原生崩溃 / 会话健康）——DSN 未配置即完整 no-op
// 边界：本文件只负责 Sentry 生命周期与事件脱敏；错误出口仍收敛在 utils/error-report.ts
// 决策：只初始化主进程 SDK，渲染层错误经 telemetry:captureError IPC 转发到主进程统一发送——
// 渲染层不引入 Sentry SDK，避免 DSN 分发、CSP connect-src 放行与两套采样配置

import { createRequire } from 'node:module';

import { EXECUTABLE_NAME, type TelemetryLevel } from '@code-agent/shared/main';
import type { ErrorEvent } from '@sentry/electron/main';
import { app } from 'electron';
import { setErrorCaptureSink } from '../../utils/error-report';
import { registerTelemetryFlush } from '../../utils/telemetry-flush';
import { redactSensitive, redactText } from './redact';

/** Sentry 运行时模块（只取实际用到的成员） */
type SentryModule = typeof import('@sentry/electron/main');

// Electron 主进程是 ESM，但 Sentry 的 ESM 构建 `import { app } from 'electron'` 在
// Electron ESM 加载器下报 "does not provide an export named 'app'"；改走 CJS 入口
// （package exports 的 require 条件）稳定加载。类型仍用 ESM 声明，运行时才 require。
const require = createRequire(import.meta.url);

let sentryModule: SentryModule | null = null;

/** 惰性加载 Sentry CJS 入口（未配置 DSN 时完全不加载 SDK） */
function loadSentryModule(): SentryModule {
  if (sentryModule === null) {
    sentryModule = require('@sentry/electron/main') as SentryModule;
  }
  return sentryModule;
}

/** Sentry 未启用原因（日志与诊断包展示用；不等同于错误级别） */
type SentryDisabledReason = 'telemetry-off' | 'no-dsn' | 'init-failed';

/** Sentry 运行状态快照（诊断包导出；不包含 DSN） */
export interface SentryStatus {
  /** 是否已成功初始化（DSN + 遥测级别均满足） */
  readonly enabled: boolean;
  /** SDK 是否处于活动状态 */
  readonly initialized: boolean;
  /** 未启用原因（enabled=true 时为 null） */
  readonly reason: SentryDisabledReason | null;
  /** 上报使用的 release（与 source map 上传一致；未启用时为 null） */
  readonly release: string | null;
  /** 上报环境（production / development 或 SENTRY_ENVIRONMENT） */
  readonly environment: string | null;
}

/** 上报附加上下文（与 utils/error-report 的同名结构对齐） */
export interface SentryErrorContext {
  readonly tags?: Readonly<Record<string, string>>;
  readonly componentStack?: string;
}

/** 渲染层错误载荷（IPC 转发；字段已由 shared schema 限长） */
export interface RendererErrorPayload {
  readonly name?: string | undefined;
  readonly message: string;
  readonly stack?: string | undefined;
  readonly componentStack?: string | undefined;
  readonly tags?: Readonly<Record<string, string>> | undefined;
}

interface SentryState {
  enabled: boolean;
  initialized: boolean;
  reason: SentryDisabledReason | null;
  release: string | null;
  environment: string | null;
}

const state: SentryState = {
  enabled: false,
  initialized: false,
  reason: null,
  release: null,
  environment: null,
};

/** 构建期注入的 DSN（electron.vite.config.ts 的 define；测试/Vitest 下为 undefined） */
function readBuildDsn(): string {
  // biome-ignore lint/correctness/noUndeclaredVariables: 由 Vite define 在构建期替换的全局常量
  return typeof __SENTRY_DSN__ === 'string' ? __SENTRY_DSN__.trim() : '';
}

/**
 * 解析生效 DSN：运行时环境变量优先于构建期注入（便于本地调试覆盖）
 *
 * @param env 环境变量（测试注入）
 * @param buildDsn 构建期 DSN（测试注入）
 * @returns 去空白后的 DSN；未配置为空串
 */
export function resolveSentryDsn(
  env: NodeJS.ProcessEnv = process.env,
  buildDsn: string = readBuildDsn(),
): string {
  const runtime = env['SENTRY_DSN']?.trim();
  if (runtime !== undefined && runtime !== '') {
    return runtime;
  }
  return buildDsn.trim();
}

/** 脱敏一组 tags（只处理字符串值，调用方已由 schema 限长） */
function redactTags(tags: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    result[key] = redactText(value);
  }
  return result;
}

/**
 * 事件发送前脱敏：消息 / 异常值 / 面包屑 / tags / extra / contexts / request 全量过规则
 *
 * 原生崩溃的 minidump 附件不经过 beforeSend（二进制），由 Sentry 服务端数据清洗兜底；
 * 本地日志与诊断包导出时另有同一套规则（infra/telemetry/redact.ts）。
 */
function redactEvent(event: ErrorEvent): ErrorEvent {
  const next: ErrorEvent = { ...event };

  if (next.message !== undefined) {
    next.message = redactText(next.message);
  }
  if (next.logentry?.message !== undefined) {
    next.logentry = { ...next.logentry, message: redactText(next.logentry.message) };
  }
  if (next.exception?.values !== undefined) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((exception) => {
        const value = { ...exception };
        if (value.value !== undefined) {
          value.value = redactText(value.value);
        }
        return value;
      }),
    };
  }
  if (next.breadcrumbs !== undefined) {
    next.breadcrumbs = next.breadcrumbs.map((breadcrumb) => {
      const value = { ...breadcrumb };
      if (value.message !== undefined) {
        value.message = redactText(value.message);
      }
      if (value.data !== undefined) {
        value.data = redactSensitive(value.data) as typeof value.data;
      }
      return value;
    });
  }
  if (next.tags !== undefined) {
    next.tags = redactSensitive(next.tags) as typeof next.tags;
  }
  if (next.extra !== undefined) {
    next.extra = redactSensitive(next.extra) as typeof next.extra;
  }
  if (next.contexts !== undefined) {
    // trace context 的 trace_id 是 32 位 hex，会被值形态规则误伤；保留它才能维持 Sentry 链路关联
    const traceContext = next.contexts['trace'];
    next.contexts = redactSensitive(next.contexts) as typeof next.contexts;
    if (traceContext !== undefined) {
      next.contexts['trace'] = traceContext;
    }
  }
  if (next.request !== undefined) {
    next.request = redactSensitive(next.request) as typeof next.request;
  }

  return next;
}

/**
 * 初始化 Sentry（启动序列调用；重复调用幂等）
 *
 * - 遥测级别 off → 不初始化（完整 no-op，不注册 crashReporter / 全局钩子）
 * - DSN 缺失 → 不初始化，返回 no-dsn 状态供日志说明
 * - 初始化失败 → 吞掉异常并返回 init-failed，遥测绝不能影响主流程
 *
 * @param level 启动时读取的遥测级别
 * @returns 初始化后的状态快照
 */
export function initSentry(level: TelemetryLevel): SentryStatus {
  if (state.initialized) {
    return getSentryStatus();
  }
  if (level === 'off') {
    state.reason = 'telemetry-off';
    return getSentryStatus();
  }

  const dsn = resolveSentryDsn();
  if (dsn === '') {
    state.reason = 'no-dsn';
    return getSentryStatus();
  }

  const environment =
    process.env['SENTRY_ENVIRONMENT']?.trim() ?? (app.isPackaged ? 'production' : 'development');
  const release = process.env['SENTRY_RELEASE']?.trim() ?? `${EXECUTABLE_NAME}@${app.getVersion()}`;

  try {
    const sdk = loadSentryModule();
    sdk.init({
      dsn,
      environment,
      release,
      // 只做错误/崩溃（性能与日志走自建 OTel 管线，避免 Sentry 配额双扣）
      tracesSampleRate: 0,
      includeLocalVariables: false,
      maxBreadcrumbs: 50,
      attachStacktrace: true,
      // 经典 IPC 模式：不注册自定义协议；preload 注入集成另行过滤——
      // 本应用不使用渲染层 Sentry SDK，注入只会增加每个窗口的额外 preload 面
      ipcMode: sdk.IPCMode.Classic,
      integrations: (integrations) =>
        integrations.filter((integration) => integration.name !== 'PreloadInjection'),
      ignoreErrors: [
        /AbortError/,
        /ResizeObserver loop limit exceeded/,
        /The operation was aborted/,
      ],
      beforeSend: (event) => redactEvent(event),
      beforeBreadcrumb: (breadcrumb) => {
        const next = { ...breadcrumb };
        if (next.message !== undefined) {
          next.message = redactText(next.message);
        }
        if (next.data !== undefined) {
          next.data = redactSensitive(next.data) as typeof next.data;
        }
        return next;
      },
    });
    state.enabled = true;
    state.initialized = true;
    state.reason = null;
    state.release = release;
    state.environment = environment;
    // logger/error-report 只依赖轻量注册表，不静态引入 Sentry SDK
    registerTelemetryFlush(flushSentry);
    setErrorCaptureSink({
      captureError: captureMainError,
      captureMessage: captureMainMessage,
    });
  } catch {
    state.enabled = false;
    state.initialized = false;
    state.reason = 'init-failed';
  }
  return getSentryStatus();
}

/** 当前 Sentry 状态快照（诊断包与启动日志用） */
export function getSentryStatus(): SentryStatus {
  return {
    enabled: state.enabled,
    initialized: state.initialized,
    reason: state.reason,
    release: state.release,
    environment: state.environment,
  };
}

/** 上报主进程异常（未初始化直接返回；捕获范围只包 Sentry 自身，绝不影响调用方） */
export function captureMainError(error: unknown, context?: SentryErrorContext): void {
  if (!state.initialized) {
    return;
  }
  try {
    loadSentryModule().withScope((scope) => {
      if (context?.tags !== undefined) {
        scope.setTags(redactTags(context.tags));
      }
      if (context?.componentStack !== undefined) {
        scope.setExtra('componentStack', redactText(context.componentStack));
      }
      loadSentryModule().captureException(error);
    });
  } catch {
    // Sentry 不可用不能反噬错误处理路径
  }
}

/** 上报主进程消息（无异常对象时用；仅 error / warning 级） */
export function captureMainMessage(message: string, level: 'error' | 'warning'): void {
  if (!state.initialized) {
    return;
  }
  try {
    const sdk = loadSentryModule();
    sdk.withScope((scope) => {
      scope.setLevel(level);
      sdk.captureMessage(redactText(message));
    });
  } catch {
    // 同上：遥测是 best-effort
  }
}

/**
 * 上报渲染层转发来的错误（IPC handler 调用）
 *
 * 用渲染层原始 stack 重建 Error，保留跨进程的调用链；tags 补 error.source=renderer，
 * 便于与主进程错误分开检索。
 */
export function captureRendererError(payload: RendererErrorPayload): void {
  if (!state.initialized) {
    return;
  }
  try {
    const error = new Error(payload.message);
    if (payload.name !== undefined) {
      error.name = payload.name;
    }
    if (payload.stack !== undefined) {
      error.stack = payload.stack;
    }
    const sdk = loadSentryModule();
    sdk.withScope((scope) => {
      scope.setTags({
        ...redactTags(payload.tags ?? {}),
        'error.source': 'renderer',
        'app.process': 'renderer',
      });
      if (payload.componentStack !== undefined) {
        scope.setExtra('componentStack', redactText(payload.componentStack));
      }
      sdk.captureException(error, {
        mechanism: { handled: true, type: 'renderer.ipc' },
      });
    });
  } catch {
    // 遥测是 best-effort
  }
}

/** 退出前冲刷待发送事件（超时不阻塞退出） */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!state.initialized) {
    return;
  }
  try {
    await loadSentryModule().flush(timeoutMs);
  } catch {
    // 退出路径不因遥测失败改变退出码
  }
}

/** 关闭 Sentry 客户端（退出善后链最后一步；关闭后状态回到未初始化） */
export async function closeSentry(timeoutMs = 2_000): Promise<void> {
  if (!state.initialized) {
    return;
  }
  try {
    await loadSentryModule().close(timeoutMs);
  } catch {
    // 关闭失败不阻塞退出
  } finally {
    state.enabled = false;
    state.initialized = false;
    state.reason = 'telemetry-off';
    state.release = null;
    state.environment = null;
    setErrorCaptureSink(null);
  }
}
