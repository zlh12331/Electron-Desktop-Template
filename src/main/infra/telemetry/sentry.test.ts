import { TraceFlags, trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ScopeMock {
  setTags: ReturnType<typeof vi.fn>;
  setExtra: ReturnType<typeof vi.fn>;
  setLevel: ReturnType<typeof vi.fn>;
  setContext: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const scope: ScopeMock = {
    setTags: vi.fn(),
    setExtra: vi.fn(),
    setLevel: vi.fn(),
    setContext: vi.fn(),
  };
  return {
    scope,
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    flush: vi.fn(async () => true),
    close: vi.fn(async () => true),
    withScope: vi.fn((callback: (scope: ScopeMock) => void) => callback(scope)),
    app: {
      isPackaged: true,
      getVersion: vi.fn(() => '1.2.3'),
    },
  };
});

vi.mock('electron', () => ({ app: mocks.app }));

// sentry.ts 通过 createRequire 加载 CJS 入口；测试注入同一组 mock
vi.mock('node:module', () => ({
  createRequire: () => () => ({
    init: mocks.init,
    captureException: mocks.captureException,
    captureMessage: mocks.captureMessage,
    flush: mocks.flush,
    close: mocks.close,
    withScope: mocks.withScope,
    ['IPCMode']: { ['Classic']: 1, ['Protocol']: 2, ['Both']: 3 },
  }),
}));

import type { ElectronMainOptions, ErrorEvent } from '@sentry/electron/main';
import { flushTelemetryOnFatal } from '../../utils/telemetry-flush';
import {
  captureMainError,
  captureMainMessage,
  captureRendererError,
  closeSentry,
  flushSentry,
  getSentryActiveConfig,
  getSentryStatus,
  initSentry,
} from './sentry';
import { getTelemetryHealth, resetTelemetryHealth } from './telemetry-health';

function lastInitOptions(): ElectronMainOptions {
  const call = mocks.init.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('init 未被调用');
  }
  return call[0] as ElectronMainOptions;
}

beforeEach(async () => {
  await closeSentry();
  vi.clearAllMocks();
  vi.stubEnv('SENTRY_DSN', '');
  vi.stubEnv('SENTRY_ENVIRONMENT', '');
  vi.stubEnv('SENTRY_RELEASE', '');
  resetTelemetryHealth();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('initSentry', () => {
  it('遥测 off：完整 no-op，不调用 SDK init', () => {
    const status = initSentry('off');
    expect(mocks.init).not.toHaveBeenCalled();
    expect(status).toMatchObject({ enabled: false, initialized: false, reason: 'telemetry-off' });
  });

  it('无 DSN：no-op 并返回 no-dsn', () => {
    const status = initSentry('full');
    expect(mocks.init).not.toHaveBeenCalled();
    expect(status).toMatchObject({ enabled: false, reason: 'no-dsn' });
  });

  it('有 DSN：release/environment 正确，性能采样为 0，过滤 preload 注入', () => {
    process.env['SENTRY_DSN'] = 'https://key@sentry.example.com/1';
    const status = initSentry('full');
    expect(status).toMatchObject({
      enabled: true,
      initialized: true,
      reason: null,
      release: 'electron-desktop-template@1.2.3',
      environment: 'production',
    });

    const options = lastInitOptions();
    expect(options).toMatchObject({
      dsn: 'https://key@sentry.example.com/1',
      release: 'electron-desktop-template@1.2.3',
      environment: 'production',
      tracesSampleRate: 0,
      includeLocalVariables: false,
      ipcMode: 1,
    });

    const integrations = options.integrations as (items: { name: string }[]) => {
      name: string;
    }[];
    expect(integrations([{ name: 'PreloadInjection' }, { name: 'Other' }])).toEqual([
      { name: 'Other' },
    ]);
  });

  it('内部配置复用初始化 buildDSN，不受后续环境变化影响，关闭时清除', async () => {
    vi.stubGlobal('__SENTRY_DSN__', 'https://build-key@example.invalid/1');
    initSentry('full');
    const config = getSentryActiveConfig();
    expect(config?.dsn).toBe('https://build-key@example.invalid/1');
    expect(lastInitOptions().dsn).toBe(config?.dsn);
    process.env['SENTRY_DSN'] = 'https://other-key@example.invalid/2';
    expect(getSentryActiveConfig()?.dsn).toBe('https://build-key@example.invalid/1');
    expect(getSentryStatus()).not.toHaveProperty('dsn');
    await closeSentry();
    expect(getSentryActiveConfig()).toBeNull();
    expect(flushTelemetryOnFatal()).toBeNull();
  });

  it('SENTRY_ENVIRONMENT / SENTRY_RELEASE 覆盖默认值', () => {
    process.env['SENTRY_DSN'] = 'https://key@sentry.example.com/1';
    process.env['SENTRY_ENVIRONMENT'] = 'staging';
    process.env['SENTRY_RELEASE'] = 'custom@2.0.0';
    initSentry('error-only');
    expect(mocks.init.mock.calls[0]?.[0]).toMatchObject({
      environment: 'staging',
      release: 'custom@2.0.0',
    });
  });

  it('幂等：重复 init 不再调用 SDK', () => {
    process.env['SENTRY_DSN'] = 'https://key@sentry.example.com/1';
    initSentry('full');
    initSentry('full');
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it('beforeSend：消息/异常/面包屑/extra 全部脱敏', () => {
    process.env['SENTRY_DSN'] = 'https://key@sentry.example.com/1';
    initSentry('full');
    const options = lastInitOptions();
    const redacted = options.beforeSend?.(
      {
        type: undefined,
        message: 'token=sk-aaaaaaaa',
        exception: { values: [{ value: 'Bearer aaaaaaaa' }] },
        breadcrumbs: [{ message: 'secret sk-aaaaaaaa', data: { token: 't' } }],
        extra: { apiKey: 'secret', user: 'alice' },
        tags: { token: 'abc', route: '/home' },
        contexts: {
          trace: {
            ['trace_id']: '0123456789abcdef0123456789abcdef',
            ['span_id']: '0123456789abcdef',
          },
        },
      },
      {},
    );
    expect(redacted).toMatchObject({
      message: 'token=[REDACTED]',
      exception: { values: [{ value: 'Bearer [REDACTED]' }] },
      breadcrumbs: [{ message: 'secret sk-[REDACTED]', data: { token: '[REDACTED]' } }],
      extra: { apiKey: '[REDACTED]', user: 'alice' },
      tags: { token: '[REDACTED]', route: '/home' },
      contexts: {
        trace: {
          ['trace_id']: '0123456789abcdef0123456789abcdef',
          ['span_id']: '0123456789abcdef',
        },
      },
    });
  });
});

describe('capture', () => {
  beforeEach(() => {
    process.env['SENTRY_DSN'] = 'https://key@sentry.example.com/1';
    initSentry('full');
  });

  it('captureMainError：tags 脱敏后进 scope，异常进 SDK', () => {
    const error = new Error('boom');
    captureMainError(error, {
      tags: { channel: 'app:getInfo', token: 'sk-aaaaaaaa' },
      componentStack: 'at Component',
    });
    expect(mocks.scope.setTags).toHaveBeenCalledWith({
      channel: 'app:getInfo',
      token: '[REDACTED]',
    });
    expect(mocks.scope.setExtra).toHaveBeenCalledWith('componentStack', 'at Component');
    expect(mocks.captureException).toHaveBeenCalledWith(error);
  });

  it.each([TraceFlags.SAMPLED, TraceFlags.NONE])(
    '原生 active context 进入非 tag context，采样标志 %s',
    (flags) => {
      const spanContext = {
        traceId: '123456789abcdef0123456789abcdef0',
        spanId: '123456789abcdef0',
        traceFlags: flags,
      };
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(trace.wrapSpanContext(spanContext));
      captureMainError(new Error('main'), { tags: { 'app.trace_id': 'request-uuid' } });
      captureRendererError({ message: 'renderer' }, 'request-uuid');
      expect(mocks.scope.setContext).toHaveBeenCalledTimes(2);
      expect(mocks.scope.setContext).toHaveBeenCalledWith('opentelemetry', {
        ['trace_id']: spanContext.traceId,
        ['span_id']: spanContext.spanId,
        sampled: flags === TraceFlags.SAMPLED,
      });
      expect(JSON.stringify(mocks.scope.setTags.mock.calls)).not.toContain(spanContext.traceId);
      expect(JSON.stringify(mocks.scope.setTags.mock.calls)).toContain('request-uuid');
    },
  );

  it('没有 active span 时不伪造原生关联；SDK 与坏 getter 都不会二次抛错', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
    captureMainError(new Error('main'));
    expect(mocks.scope.setContext).not.toHaveBeenCalled();
    mocks.captureException.mockImplementationOnce(() => {
      throw new Error('sdk');
    });
    expect(() => captureMainError(new Error('main'))).not.toThrow();
    expect(() =>
      captureRendererError({
        get message(): never {
          throw new Error('getter');
        },
      }),
    ).not.toThrow();
  });

  it('captureMainMessage：warning 级别 + 正文脱敏', () => {
    captureMainMessage('token=sk-aaaaaaaa', 'warning');
    expect(mocks.scope.setLevel).toHaveBeenCalledWith('warning');
    expect(mocks.captureMessage).toHaveBeenCalledWith('token=[REDACTED]');
  });

  it('captureRendererError：重建 Error + renderer tags + componentStack', () => {
    captureRendererError(
      {
        name: 'TypeError',
        message: 'renderer boom',
        stack: 'TypeError: renderer boom\n at app.tsx:1:1',
        componentStack: 'at Panel',
        tags: { boundary: 'SectionErrorBoundary' },
      },
      'trace-123',
    );
    expect(mocks.scope.setTags).toHaveBeenCalledWith({
      boundary: 'SectionErrorBoundary',
      'error.source': 'renderer',
      'app.process': 'renderer',
      'app.trace_id': 'trace-123',
    });
    expect(mocks.scope.setExtra).toHaveBeenCalledWith('componentStack', 'at Panel');
    const captured = mocks.captureException.mock.calls[0]?.[0] as Error;
    expect(captured).toBeInstanceOf(Error);
    expect(captured.name).toBe('TypeError');
    expect(captured.message).toBe('renderer boom');
    expect(captured.stack).toContain('app.tsx');
  });

  it('未初始化时 capture 全部 no-op', async () => {
    await closeSentry();
    mocks.captureException.mockClear();
    captureMainError(new Error('x'));
    captureRendererError({ message: 'x' });
    captureMainMessage('x', 'error');
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });
});

describe('beforeSend 内存配额与脱敏边界', () => {
  beforeEach(() => {
    process.env['SENTRY_DSN'] = 'https://key@example.invalid/1';
    initSentry('full');
  });

  it('自动与手动事件共用同指纹 5/min 配额，窗口恢复且计数可重置', () => {
    vi.useFakeTimers();
    const send = lastInitOptions().beforeSend;
    const event: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: 'Error', value: 'same' }] },
    };
    for (let i = 0; i < 5; i += 1) {
      expect(send?.(event, {})).not.toBeNull();
    }
    expect(send?.(event, { originalException: new Error('same') })).toBeNull();
    expect(getTelemetryHealth().suppressedErrors).toBe(1);
    awaitWindow();
    expect(send?.(event, {})).not.toBeNull();
    resetTelemetryHealth();
    expect(getTelemetryHealth().suppressedErrors).toBe(0);
  });

  it('全局 60/min 防高基数洪泛，fatal/unhandled 不受闸也不消耗预算', () => {
    const send = lastInitOptions().beforeSend;
    for (let i = 0; i < 60; i += 1) {
      expect(send?.({ type: undefined, message: `unique-${i}` }, {})).not.toBeNull();
    }
    for (let i = 0; i < 1_000; i += 1) {
      expect(send?.({ type: undefined, message: `flood-${i}` }, {})).toBeNull();
    }
    expect(getTelemetryHealth().suppressedErrors).toBe(1_000);
    expect(send?.({ type: undefined, level: 'fatal', message: 'fatal' }, {})).not.toBeNull();
    expect(
      send?.(
        {
          type: undefined,
          exception: {
            values: [{ value: 'unhandled', mechanism: { type: 'onerror', handled: false } }],
          },
        },
        {},
      ),
    ).not.toBeNull();
    expect(getTelemetryHealth().suppressedErrors).toBe(1_000);
  });

  it('保留合法原生 IDs 但 trace context 的其他字段仍脱敏且无原引用', () => {
    const traceContext = {
      ['trace_id']: '123456789abcdef0123456789abcdef0',
      ['span_id']: '123456789abcdef0',
      sampled: true,
      password: 'abc',
      nested: { credentials: ['abc'] },
    };
    const event: ErrorEvent = {
      type: undefined,
      ['event_id']: '123456789abcdef0123456789abcdef0',
      contexts: { trace: traceContext, opentelemetry: traceContext },
      tags: { 'app.trace_id': 'request-uuid' },
      exception: {
        values: [
          {
            type: 'password=abc',
            value: 'token=abc',
            stacktrace: {
              frames: [{ filename: 'https://alice:abc@example.invalid/file?token=abc' }],
            },
          },
        ],
      },
    };
    const result = lastInitOptions().beforeSend?.(event, {}) as ErrorEvent;
    expect(result.contexts?.['opentelemetry']).toEqual({
      ['trace_id']: traceContext['trace_id'],
      ['span_id']: traceContext['span_id'],
      sampled: true,
      password: '[REDACTED]',
      nested: { credentials: '[REDACTED]' },
    });
    expect(result.contexts?.['trace']).not.toBe(traceContext);
    expect(result.event_id).toBe(event.event_id);
    expect(result.tags?.['app.trace_id']).toBe('request-uuid');
    expect(JSON.stringify(result)).not.toContain('abc@example');
    expect(JSON.stringify(result)).not.toContain('=abc');
    expect(traceContext.password).toBe('abc');
  });

  it('坏 getter 与循环 extra 不抛错也不退回原始输入', () => {
    const extra: Record<string, unknown> = { password: 'abc' };
    extra['self'] = extra;
    Object.defineProperty(extra, 'bad', {
      enumerable: true,
      get: () => {
        throw new Error('getter');
      },
    });
    const send = lastInitOptions().beforeSend;
    const result = send?.({ type: undefined, extra }, {}) as ErrorEvent;
    expect(result.extra).toEqual({
      password: '[REDACTED]',
      self: '[Circular]',
      bad: '[Unserializable]',
    });
    const broken = {
      type: undefined,
      get exception(): never {
        throw new Error('getter');
      },
    };
    expect(() => send?.(broken, {})).not.toThrow();
    expect(send?.(broken, {})).toBeNull();
  });
});

function awaitWindow(): void {
  vi.advanceTimersByTime(60_000);
}

describe('flush / close', () => {
  it('初始化后 flush 与 close 调用 SDK；关闭后状态复位', async () => {
    process.env['SENTRY_DSN'] = 'https://key@sentry.example.com/1';
    initSentry('full');
    await flushSentry(500);
    expect(mocks.flush).toHaveBeenCalledWith(500);
    await closeSentry(500);
    expect(mocks.close).toHaveBeenCalledWith(500);
    expect(getSentryStatus()).toMatchObject({
      enabled: false,
      initialized: false,
      reason: 'telemetry-off',
      release: null,
    });
  });

  it('未初始化时 flush/close 不调用 SDK', async () => {
    await flushSentry();
    await closeSentry();
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
