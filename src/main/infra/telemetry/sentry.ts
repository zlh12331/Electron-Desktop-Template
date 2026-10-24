// sentry.ts：Sentry 主进程接入（错误聚合 / 原生崩溃 / 会话健康）——DSN 未配置即完整 no-op
// 边界：本文件只负责 Sentry 生命周期与事件脱敏；错误出口仍收敛在 utils/error-report.ts
// 决策：只初始化主进程 SDK，渲染层错误经 telemetry:captureError IPC 转发到主进程统一发送——
// 渲染层不引入 Sentry SDK，避免 DSN 分发、CSP connect-src 放行与两套采样配置

import { createRequire } from 'node:module';

import { EXECUTABLE_NAME, type TelemetryLevel } from '@code-agent/shared/main';
import { resolveSentryConfig, type SentryResolvedConfig } from '@code-agent/shared/observability';
import {
  isSpanContextValid,
  isValidSpanId,
  isValidTraceId,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import type { ErrorEvent } from '@sentry/electron/main';
import { app } from 'electron';
import { setErrorCaptureSink } from '../../utils/error-report';
import { registerTelemetryFlush } from '../../utils/telemetry-flush';
import { readBuildInfo } from '../app-info';
import { ErrorEventRateLimiter } from './error-rate-limit';
import { redactSensitive, redactText } from './redact';
import { recordSuppressedError } from './telemetry-health';

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

let activeConfig: SentryResolvedConfig | null = null;
let unregisterFlush: (() => void) | null = null;

function redactTags(tags: Readonly<Record<string, string>>): Record<string, string> {
  return redactSensitive(tags) as Record<string, string>;
}

function preserveTraceIds(source: Record<string, unknown>, target: Record<string, unknown>): void {
  for (const key of ['trace_id', 'span_id', 'parent_span_id']) {
    const value = source[key];
    if (
      typeof value === 'string' &&
      (key === 'trace_id' ? isValidTraceId(value) : isValidSpanId(value))
    ) {
      target[key] = value;
    }
  }
}

// 只豁免合法链路 ID，不能把整个 trace context 原样带回上行。
function redactEvent(event: ErrorEvent): ErrorEvent {
  const next = redactSensitive(event) as ErrorEvent;
  if (typeof event.event_id === 'string' && isValidTraceId(event.event_id)) {
    next.event_id = event.event_id;
  }
  for (const key of ['trace', 'opentelemetry']) {
    const source = event.contexts?.[key];
    const target = next.contexts?.[key];
    if (
      source !== null &&
      typeof source === 'object' &&
      target !== null &&
      typeof target === 'object'
    ) {
      preserveTraceIds(source, target);
    }
  }
  return next;
}

// minidump 是二进制附件，不经过此文本脱敏和配额闸。
function beforeSend(event: ErrorEvent, limiter: ErrorEventRateLimiter): ErrorEvent | null {
  try {
    if (!limiter.tryAcquire(event)) {
      recordSuppressedError();
      return null;
    }
    return redactEvent(event);
  } catch {
    // 不可信 getter 或 SDK 结构异常不能二次抛错，也不能退回未脱敏事件。
    return null;
  }
}

function attachOtelContext(scope: {
  setContext(name: string, context: Record<string, unknown>): void;
}): void {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext !== undefined && isSpanContextValid(spanContext)) {
    scope.setContext('opentelemetry', {
      ['trace_id']: spanContext.traceId,
      ['span_id']: spanContext.spanId,
      sampled: (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0,
    });
  }
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

  const resolved = resolveSentryConfig(process.env, {
    level,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    executableName: EXECUTABLE_NAME,
    buildDsn: readBuildDsn(),
  });
  activeConfig = resolved;
  if (!resolved.enabled) {
    state.reason = resolved.reason;
    return getSentryStatus();
  }

  const build = readBuildInfo();
  const buildTags: Record<string, string> = {};
  if (build.channel !== undefined) {
    buildTags['app.channel'] = build.channel;
  }
  if (build.commitSha !== undefined) {
    buildTags['app.commit'] = build.commitSha;
  }

  try {
    const sdk = loadSentryModule();
    const limiter = new ErrorEventRateLimiter();
    sdk.init({
      dsn: resolved.dsn,
      environment: resolved.environment,
      release: resolved.release,
      ...(Object.keys(buildTags).length > 0 ? { initialScope: { tags: buildTags } } : {}),
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
      beforeSend: (event) => beforeSend(event, limiter),
      beforeBreadcrumb: (breadcrumb) => {
        // console 可含本地专用 fields，不能借 SDK 面包屑绕过上行字段隔离。
        if (breadcrumb.category === 'console') return null;
        const next = redactSensitive(breadcrumb);
        return next !== null && typeof next === 'object' ? next : null;
      },
    });
    state.enabled = true;
    state.initialized = true;
    state.reason = null;
    state.release = resolved.release;
    state.environment = resolved.environment;
    // logger/error-report 只依赖轻量注册表，不静态引入 Sentry SDK。
    unregisterFlush = registerTelemetryFlush('sentry', flushSentry);
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

/** 主进程内部读取启动配置（含构建期 DSN），不得经 IPC 返回渲染层。 */
export function getSentryActiveConfig(): SentryResolvedConfig | null {
  return activeConfig === null ? null : { ...activeConfig };
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
      attachOtelContext(scope);
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
export function captureRendererError(payload: RendererErrorPayload, traceId?: string): void {
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
      attachOtelContext(scope);
      scope.setTags({
        ...redactTags(payload.tags ?? {}),
        'error.source': 'renderer',
        'app.process': 'renderer',
        ...(traceId !== undefined && traceId !== '' ? { 'app.trace_id': traceId } : {}),
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
  unregisterFlush?.();
  unregisterFlush = null;
  activeConfig = null;
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
