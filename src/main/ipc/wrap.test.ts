import { join } from 'node:path';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { mockFromWebContents, mockIpcMainHandle, mockReportError } = vi.hoisted(() => ({
  mockFromWebContents: vi.fn(),
  mockIpcMainHandle: vi.fn(),
  mockReportError: vi.fn(),
}));

vi.mock('../utils/error-report', () => ({
  reportError: mockReportError,
}));

vi.mock('electron', () => ({
  app: { getAppMetrics: () => [], getAppPath: () => process.cwd() },
  ipcMain: {
    handle: mockIpcMainHandle,
  },
  // biome-ignore lint/style/useNamingConvention: mock electron BrowserWindow API，需匹配 SDK 原名
  BrowserWindow: {
    fromWebContents: mockFromWebContents,
  },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AppError, ErrorCode } from '@code-agent/shared/main';
import { ipcMain } from 'electron';
import { initOtelMetrics, resetOtelMetrics } from '../infra/telemetry/otel-metrics';
import { rendererEntryFileUrl } from '../security/renderer-url';
import { logger } from '../utils/logger';
import { wrap } from './wrap';

type InternalHandler = (
  event: { sender: unknown; senderFrame?: unknown },
  input: unknown,
  traceId?: string,
) => Promise<unknown>;

function getRegisteredHandler(): InternalHandler {
  const firstCall = vi.mocked(ipcMain.handle).mock.calls[0];
  if (!firstCall) {
    throw new Error('ipcMain.handle 未被调用');
  }
  return firstCall[1] as unknown as InternalHandler;
}

const topFrame = {};
const allowedFileUrl = rendererEntryFileUrl(process.cwd());
const allowedSender = {
  getURL: () => allowedFileUrl,
  mainFrame: topFrame,
};
const allowedEvent = { sender: allowedSender, senderFrame: topFrame };

describe('wrap', () => {
  let provider: MeterProvider;
  let exporter: InMemoryMetricExporter;

  beforeEach(() => {
    vi.clearAllMocks();
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    initOtelMetrics(provider.getMeter('wrap-test'));
  });

  afterEach(async () => {
    resetOtelMetrics();
    await provider.shutdown();
  });

  async function expectMetricClasses(classes: Record<string, number>): Promise<void> {
    await provider.forceFlush();
    const metrics = exporter
      .getMetrics()
      .flatMap((r) => r.scopeMetrics)
      .flatMap((s) => s.metrics);
    for (const name of ['ipc.server.requests', 'ipc.server.request.duration']) {
      const points = metrics.find((m) => m.descriptor.name === name)?.dataPoints;
      expect(points).toHaveLength(Object.keys(classes).length);
      for (const [failureClass, count] of Object.entries(classes)) {
        const point = points?.find((p) => p.attributes['failureClass'] === failureClass);
        expect(point?.attributes).toEqual({
          channel: 'test:channel',
          outcome: failureClass === 'none' ? 'success' : 'error',
          failureClass,
        });
        if (name === 'ipc.server.requests') expect(point?.value).toBe(count);
        else expect(point?.value).toMatchObject({ count });
      }
    }
  }

  it('完整错误码按保守值域分类，业务与系统分别计数且不含错误信息', async () => {
    mockFromWebContents.mockReturnValue({ id: 1 });
    let failure: unknown;
    wrap('test:channel', null, async () => {
      if (failure !== undefined) throw failure;
      return 'ok';
    });
    const handler = getRegisteredHandler();
    await handler(allowedEvent, undefined);
    for (const code of Object.values(ErrorCode)) {
      failure = new AppError(code, `private-message-${code}`);
      await handler(allowedEvent, undefined);
    }
    failure = new Error('private raw error');
    await handler(allowedEvent, undefined);
    expect(Object.values(ErrorCode)).toHaveLength(14);
    await expectMetricClasses({ none: 1, validation: 2, business: 4, system: 9 });
  });

  it('sender、入参校验和响应契约失败各记一次对应分类', async () => {
    mockFromWebContents.mockReturnValue(null);
    wrap('test:channel', null, async () => 'bad-response', z.literal('ok'));
    const handler = getRegisteredHandler();
    await handler(allowedEvent, undefined);
    mockFromWebContents.mockReturnValue({ id: 1 });
    await handler(allowedEvent, { unwanted: true });
    await handler(allowedEvent, undefined);
    await expectMetricClasses({ validation: 2, system: 1 });
  });

  it('成功时返回 { data }', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const schema = z.object({ name: z.string() });
    const handler = vi.fn().mockResolvedValue({ id: 1, name: 'test' });

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();

    const mockEvent = allowedEvent;
    const result = await registeredHandler(mockEvent, { name: 'test' }, 'trace-123');

    expect(result).toEqual({ data: { id: 1, name: 'test' } });
    expect(handler).toHaveBeenCalledWith(
      { name: 'test' },
      expect.objectContaining({ traceId: 'trace-123' }),
    );
    // 请求明细必须走 debug：生产 file 级别 info 不落盘，避免每次 IPC 两条 info
    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'trace-123', channel: 'test:channel' }),
      'IPC 请求成功',
    );
    expect(vi.mocked(logger.info)).not.toHaveBeenCalled();
  });

  it('参数校验失败返回 { error }', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const schema = z.object({ name: z.string().min(1) });
    const handler = vi.fn();

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();
    const mockEvent = allowedEvent;
    const result = await registeredHandler(mockEvent, { name: '' }, 'trace-456');

    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty(['error', 'code']);
    expect(result).toHaveProperty(['error', 'message']);
    expect(handler).not.toHaveBeenCalled();
  });

  it('sender 无效返回 { error }', async () => {
    mockFromWebContents.mockReturnValue(null);

    const schema = z.object({ name: z.string() });
    const handler = vi.fn();

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();
    const mockEvent = allowedEvent;
    const result = await registeredHandler(mockEvent, { name: 'test' }, undefined);

    expect(result).toHaveProperty('error');
    const error = (result as { error: { code: string } }).error;
    expect(error.code).toBe(ErrorCode.IPC_SENDER_INVALID);
    expect(handler).not.toHaveBeenCalled();
  });

  it('子 frame 调用返回 IPC_SENDER_INVALID', async () => {
    mockFromWebContents.mockReturnValue({ id: 1 });
    wrap('test:channel', null, async () => 'ok');
    const registeredHandler = getRegisteredHandler();

    const result = await registeredHandler(
      { sender: allowedSender, senderFrame: { parent: topFrame } },
      undefined,
    );

    expect(result).toMatchObject({ error: { code: ErrorCode.IPC_SENDER_INVALID } });
  });

  it('file URL 带 hash 仍是合法 sender（生产 hash router）', async () => {
    mockFromWebContents.mockReturnValue({ id: 1 });
    const handler = vi.fn(async () => 'ok');
    wrap('test:channel', null, handler);
    const registeredHandler = getRegisteredHandler();
    const sender = {
      getURL: () => `${allowedFileUrl}#/about`,
      mainFrame: topFrame,
    };

    const result = await registeredHandler({ sender, senderFrame: topFrame }, undefined);

    expect(result).toEqual({ data: 'ok' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('file URL 带 query 不被视为合法 sender', async () => {
    mockFromWebContents.mockReturnValue({ id: 1 });
    wrap('test:channel', null, async () => 'ok');
    const registeredHandler = getRegisteredHandler();
    const sender = {
      getURL: () => `${allowedFileUrl}?spoof=1`,
      mainFrame: topFrame,
    };

    const result = await registeredHandler({ sender, senderFrame: topFrame }, undefined);

    expect(result).toMatchObject({ error: { code: ErrorCode.IPC_SENDER_INVALID } });
  });

  it('同后缀不同目录的 file URL 不被视为合法 sender', async () => {
    mockFromWebContents.mockReturnValue({ id: 1 });
    wrap('test:channel', null, async () => 'ok');
    const registeredHandler = getRegisteredHandler();
    const sender = {
      getURL: () => rendererEntryFileUrl(join(process.cwd(), 'other-app')),
      mainFrame: topFrame,
    };

    const result = await registeredHandler({ sender, senderFrame: topFrame }, undefined);

    expect(result).toMatchObject({ error: { code: ErrorCode.IPC_SENDER_INVALID } });
  });

  it('handler 抛出 AppError 返回 { error }', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const schema = z.object({ name: z.string() });
    const handler = vi.fn().mockRejectedValue(new AppError(ErrorCode.NOT_FOUND));

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();
    const mockEvent = allowedEvent;
    const result = await registeredHandler(mockEvent, { name: 'test' }, undefined);

    expect(result).toHaveProperty('error');
    const error = (result as { error: { code: string } }).error;
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
    expect(mockReportError).toHaveBeenCalled();
  });

  it('handler 抛出普通 Error 包装为 INTERNAL_ERROR', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const schema = z.object({ name: z.string() });
    const handler = vi.fn().mockRejectedValue(new Error('普通错误'));

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();
    const mockEvent = allowedEvent;
    const result = await registeredHandler(mockEvent, { name: 'test' }, undefined);

    expect(result).toHaveProperty('error');
    const error = (result as { error: { code: string } }).error;
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(mockReportError).toHaveBeenCalled();
  });

  it('无 traceId 时自动生成', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const schema = z.object({ name: z.string() });
    const handler = vi.fn().mockResolvedValue('ok');

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();
    const mockEvent = allowedEvent;
    await registeredHandler(mockEvent, { name: 'test' }, undefined);

    const ctx = handler.mock.calls[0]?.[1] as { traceId: string } | undefined;
    if (!ctx) {
      throw new Error('handler 未被调用或 ctx 缺失');
    }
    expect(ctx.traceId).toBeDefined();
    expect(typeof ctx.traceId).toBe('string');
    expect(ctx.traceId.length).toBeGreaterThan(0);
  });

  it('响应契约校验：结构合法时正常返回 { data }', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const resSchema = z.object({ entityId: z.string().min(1) });
    const handler = vi.fn().mockResolvedValue({ entityId: 'entity-1' });

    wrap('test:channel', null, handler, resSchema);

    const registeredHandler = getRegisteredHandler();
    const result = await registeredHandler(allowedEvent, undefined, undefined);

    expect(result).toEqual({ data: { entityId: 'entity-1' } });
  });

  it('响应契约校验：结构不符返回 INVALID_RESPONSE（防手写 Res 接口漂移）', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const resSchema = z.object({ entityId: z.string().min(1) });
    const handler = vi.fn().mockResolvedValue({ ok: true });

    wrap('test:channel', null, handler, resSchema);

    const registeredHandler = getRegisteredHandler();
    const result = await registeredHandler(allowedEvent, undefined, undefined);

    expect(result).toHaveProperty('error');
    const error = (result as { error: { code: string } }).error;
    expect(error.code).toBe(ErrorCode.INVALID_RESPONSE);
    // 响应契约漂移是内部缺陷：必须进错误聚合，不能只写一行本地日志
    expect(mockReportError).toHaveBeenCalled();
  });

  it('P0 收口：schema 未声明字段被 strip（边界生效，不只检查）', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const resSchema = z.object({
      config: z.object({ name: z.string() }),
    });
    const handler = vi.fn().mockResolvedValue({
      config: {
        name: 'fs',
        headers: Object.fromEntries([['Authorization', 'Bearer secret']]),
        env: Object.fromEntries([['KEY', 'v']]),
      },
    });

    wrap('test:channel', null, handler, resSchema);

    const registeredHandler = getRegisteredHandler();
    const result = (await registeredHandler(allowedEvent, undefined, undefined)) as {
      data: { config: Record<string, unknown> };
    };

    expect(result.data.config).toEqual({ name: 'fs' });
    expect(result.data.config).not.toHaveProperty('headers');
    expect(result.data.config).not.toHaveProperty('env');
  });

  it('无 resSchema 时 handler 返回原样透传（不引入裁剪行为）', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const handler = vi.fn().mockResolvedValue({ anything: true, extra: [1, 2] });

    wrap('test:channel', null, handler);

    const registeredHandler = getRegisteredHandler();
    const result = (await registeredHandler(allowedEvent, undefined, undefined)) as {
      data: unknown;
    };

    expect(result.data).toEqual({ anything: true, extra: [1, 2] });
  });

  it('P2 加固：非法外部 traceId 被丢弃并替换为生成的 UUID', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const schema = z.object({ name: z.string() });
    const handler = vi.fn().mockResolvedValue({ ok: true });

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();
    await registeredHandler(allowedEvent, { name: 'x' }, 'bad id\\nINJECTED');

    const ctx = handler.mock.calls[0]?.[1] as { traceId: string } | undefined;
    if (!ctx) {
      throw new Error('handler 未被调用或 ctx 缺失');
    }
    expect(ctx.traceId).not.toContain('bad id');
    expect(ctx.traceId).toMatch(/^[\w-]{8,64}$/);
  });

  it('P2 加固：非白名单来源 URL 返回 IPC_SENDER_INVALID', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const schema = z.object({ name: z.string() });
    const handler = vi.fn();

    wrap('test:channel', schema, handler);

    const registeredHandler = getRegisteredHandler();
    const evilSender = { getURL: () => 'https://evil.example.com/payload' };
    const result = await registeredHandler({ sender: evilSender }, { name: 'x' }, undefined);

    expect(handler).not.toHaveBeenCalled();
    const error = (result as { error: { code: string } }).error;
    expect(error.code).toBe(ErrorCode.IPC_SENDER_INVALID);
  });

  it('P2 加固：null schema 时收到非 undefined 入参返回 INVALID_INPUT', async () => {
    const mockWin = { id: 1 };
    mockFromWebContents.mockReturnValue(mockWin);

    const handler = vi.fn().mockResolvedValue({ ok: true });

    wrap('test:channel', null, handler);

    const registeredHandler = getRegisteredHandler();
    const result = await registeredHandler(allowedEvent, { sneaky: true }, undefined);

    expect(handler).not.toHaveBeenCalled();
    const error = (result as { error: { code: string } }).error;
    expect(error.code).toBe(ErrorCode.INVALID_INPUT);
  });
});
