import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ScopeMock {
  setTags: ReturnType<typeof vi.fn>;
  setExtra: ReturnType<typeof vi.fn>;
  setLevel: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const scope: ScopeMock = {
    setTags: vi.fn(),
    setExtra: vi.fn(),
    setLevel: vi.fn(),
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

import type { ElectronMainOptions } from '@sentry/electron/main';
import {
  captureMainError,
  captureMainMessage,
  captureRendererError,
  closeSentry,
  flushSentry,
  getSentryStatus,
  initSentry,
} from './sentry';

function lastInitOptions(): ElectronMainOptions {
  const call = mocks.init.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('init 未被调用');
  }
  return call[0] as ElectronMainOptions;
}

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env['SENTRY_DSN'];
  delete process.env['SENTRY_ENVIRONMENT'];
  delete process.env['SENTRY_RELEASE'];
  await closeSentry();
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
      message: 'token=sk-[REDACTED]',
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
      token: 'sk-[REDACTED]',
    });
    expect(mocks.scope.setExtra).toHaveBeenCalledWith('componentStack', 'at Component');
    expect(mocks.captureException).toHaveBeenCalledWith(error);
  });

  it('captureMainMessage：warning 级别 + 正文脱敏', () => {
    captureMainMessage('token=sk-aaaaaaaa', 'warning');
    expect(mocks.scope.setLevel).toHaveBeenCalledWith('warning');
    expect(mocks.captureMessage).toHaveBeenCalledWith('token=sk-[REDACTED]');
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
