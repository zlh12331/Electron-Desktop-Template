import { EventEmitter } from 'node:events';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile, readdir: vi.fn(), rm: vi.fn(), stat: vi.fn() }));
vi.mock('electron', () => ({
  ['app']: { getAppMetrics: () => [], getVersion: () => '1.0.0', getAppPath: () => 'F:/fake-app' },
  ['BrowserWindow']: { getAllWindows: () => [] },
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initOtelMetrics, resetOtelMetrics } from '../telemetry/otel-metrics';
import { type AutoUpdaterLike, type CancellationTokenLike, UpdateService } from './update-service';

class FakeUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  forceDevUpdateConfig = false;
  logger: AutoUpdaterLike['logger'] = null;
  checkForUpdates = vi.fn(async (): Promise<unknown> => {
    this.emit('checking-for-update');
    this.emit('update-not-available');
    return undefined;
  });
  downloadUpdate = vi.fn(async (_token?: CancellationTokenLike): Promise<unknown> => undefined);
  quitAndInstall = vi.fn();
}

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let updater: FakeUpdater;
let service: UpdateService;
let provider: MeterProvider;
let exporter: InMemoryMetricExporter;
let traceProvider: NodeTracerProvider;
let spanExporter: InMemorySpanExporter;

function createService(packaged = true): UpdateService {
  return new UpdateService(
    updater,
    () => packaged,
    () => {
      const token = {
        cancelled: false,
        cancel: () => {
          token.cancelled = true;
        },
      };
      return token;
    },
  );
}

function metric(name: string): MetricData | undefined {
  return exporter
    .getMetrics()
    .at(-1)
    ?.scopeMetrics.flatMap((s) => s.metrics)
    .find((m) => m.descriptor.name === name);
}

async function flush(): Promise<void> {
  const flushing = Promise.all([provider.forceFlush(), traceProvider.forceFlush()]);
  // SDK 内存导出器以零延迟 timer 回执，推进虚拟时钟而不替换真实 exporter。
  await vi.advanceTimersByTimeAsync(1);
  await flushing;
}

function expectDownload(outcome: string, count = 1): void {
  expect(metric('app.update.download.duration')?.dataPoints).toEqual([
    expect.objectContaining({ attributes: { outcome }, value: expect.objectContaining({ count }) }),
  ]);
  const terminal = metric('app.update.events')?.dataPoints.filter((p) =>
    ['downloaded', 'cancelled', 'error'].includes(String(p.attributes['phase'])),
  );
  expect(terminal).toEqual([
    expect.objectContaining({ attributes: { phase: outcome }, value: count }),
  ]);
}

beforeEach(() => {
  vi.useFakeTimers();
  readFile.mockReset().mockResolvedValue('');
  updater = new FakeUpdater();
  service = createService();
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 86_400_000 })],
  });
  initOtelMetrics(provider.getMeter('update-test'));
  spanExporter = new InMemorySpanExporter();
  traceProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  traceProvider.register();
});

afterEach(async () => {
  service.dispose();
  resetOtelMetrics();
  trace.disable();
  const shutdown = Promise.all([provider.shutdown(), traceProvider.shutdown()]);
  await vi.advanceTimersByTimeAsync(1);
  await shutdown;
  vi.useRealTimers();
});

describe('update check metrics', () => {
  it('100 次检查中 10 次 error 事件加 reject 仍仅计 10 个失败，分母为 100', async () => {
    service.start({ autoCheckEnabled: () => false });
    for (let i = 0; i < 100; i += 1) {
      updater.checkForUpdates.mockImplementationOnce(async () => {
        updater.emit('checking-for-update');
        if (i < 10) {
          const error = new Error('offline');
          updater.emit('error', error);
          throw error;
        }
        updater.emit('update-not-available');
      });
      await service.check(true);
    }
    await flush();
    const points = metric('app.update.checks')?.dataPoints ?? [];
    expect(points).toEqual([
      expect.objectContaining({ attributes: { trigger: 'manual', outcome: 'error' }, value: 10 }),
      expect.objectContaining({ attributes: { trigger: 'manual', outcome: 'success' }, value: 90 }),
    ]);
    const total = points.reduce((sum, p) => sum + Number(p.value), 0);
    expect(Number(points[0]?.value) / total).toBe(0.1);
    expect(metric('app.update.check.duration')?.dataPoints.map((p) => p.value)).toEqual([
      expect.objectContaining({ count: 10 }),
      expect.objectContaining({ count: 90 }),
    ]);
    expect(
      metric('app.update.events')?.dataPoints.find((p) => p.attributes['phase'] === 'error')?.value,
    ).toBe(10);
  });

  it('unsupported 和 in-flight skip 不创建任何检查或漏斗样本', async () => {
    const unsupported = createService(false);
    try {
      await unsupported.check(true);
    } finally {
      unsupported.dispose();
    }
    const gate = deferred();
    updater.checkForUpdates.mockReturnValue(gate.promise);
    const pending = service.check(true);
    await service.check(true);
    await flush();
    expect(metric('app.update.checks')).toBeUndefined();
    expect(metric('app.update.check.duration')).toBeUndefined();
    expect(metric('app.update.events')).toBeUndefined();
    gate.resolve();
    await pending;
    await flush();
    expect(metric('app.update.checks')?.dataPoints[0]?.value).toBe(1);
    expect(metric('app.update.check.duration')?.dataPoints[0]?.value).toMatchObject({ count: 1 });
  });

  it('launch/retry/long-session/manual 保留真实 trigger，默认间隔不变', async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    service.start();
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    await service.check(true);
    await flush();
    expect(metric('app.update.checks')?.dataPoints.map((p) => [p.attributes, p.value])).toEqual([
      [{ trigger: 'launch', outcome: 'error' }, 1],
      [{ trigger: 'retry', outcome: 'success' }, 1],
      [{ trigger: 'long-session', outcome: 'success' }, 1],
      [{ trigger: 'manual', outcome: 'success' }, 1],
    ]);
  });

  it('45s 超时一次失败，迟到成功/错误事件与 resolve 不补成功或下载样本', async () => {
    service.start({ autoCheckEnabled: () => false });
    const gate = deferred();
    updater.checkForUpdates.mockReturnValue(gate.promise);
    const pending = service.check(true);
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(pending).resolves.toMatchObject({ status: 'error' });
    updater.emit('update-available', { version: '2.0.0' });
    updater.emit('update-not-available');
    updater.emit('error', new Error('late error'));
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(metric('app.update.checks')?.dataPoints).toEqual([
      expect.objectContaining({ attributes: { trigger: 'manual', outcome: 'error' }, value: 1 }),
    ]);
    expect(metric('app.update.events')?.dataPoints).toEqual([
      expect.objectContaining({ attributes: { phase: 'error' }, value: 1 }),
    ]);
    expect(metric('app.update.download.duration')).toBeUndefined();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('超时后新检查仍处理事件；复用旧 Promise 的检查 skip', async () => {
    service.start({ autoCheckEnabled: () => false });
    const old = deferred();
    updater.checkForUpdates.mockReturnValue(old.promise);
    const first = service.check(true);
    await vi.advanceTimersByTimeAsync(45_000);
    await first;
    // 复用已超时的旧 Promise → skip，不新增 check 样本
    await service.check(true);
    const next = deferred();
    updater.checkForUpdates.mockReturnValue(next.promise);
    const pending = service.check(true);
    updater.emit('update-available', { version: '2.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    old.resolve();
    await vi.advanceTimersByTimeAsync(0);
    next.resolve();
    await pending;
    await flush();
    expect(metric('app.update.checks')?.dataPoints.map((p) => [p.attributes, p.value])).toEqual([
      [{ trigger: 'manual', outcome: 'error' }, 1],
      [{ trigger: 'manual', outcome: 'success' }, 1],
    ]);
    expect(metric('app.update.events')?.dataPoints.map((p) => [p.attributes, p.value])).toEqual(
      expect.arrayContaining([
        [{ phase: 'error' }, 1],
        [{ phase: 'available' }, 1],
      ]),
    );
  });

  it('仅 error 事件但 Promise resolve 仍算失败且 span 为 ERROR', async () => {
    service.start({ autoCheckEnabled: () => false });
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('error', new Error('failed'));
    });
    await expect(service.check(true)).resolves.toMatchObject({ status: 'error' });
    await flush();
    expect(metric('app.update.checks')?.dataPoints[0]).toMatchObject({
      attributes: { outcome: 'error' },
      value: 1,
    });
    expect(spanExporter.getFinishedSpans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('download attempt terminal metrics', () => {
  it.each(['promise', 'event', 'both'] as const)('成功 %s 终态只记一次', async (source) => {
    const gate = deferred();
    updater.downloadUpdate.mockReturnValue(gate.promise);
    service.start({ autoCheckEnabled: () => false });
    updater.emit('update-available', { version: '2.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    if (source !== 'promise') {
      updater.emit('update-downloaded', { version: '2.0.0' });
      updater.emit('update-downloaded', { version: '2.0.0' });
    }
    if (source !== 'event') gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expectDownload('downloaded');
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(['promise', 'event', 'both'] as const)('错误 %s 终态只记一次', async (source) => {
    const gate = deferred();
    updater.downloadUpdate.mockReturnValue(gate.promise);
    service.start({ autoCheckEnabled: () => false });
    updater.emit('update-available', { version: '2.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    const error = new Error('network failure');
    if (source !== 'promise') {
      updater.emit('error', error);
      updater.emit('error', error);
    }
    if (source !== 'event') gate.reject(error);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expectDownload('error');
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(
      spanExporter
        .getFinishedSpans()
        .filter((span) => span.name === 'update.download')
        .map((span) => span.status.code),
    ).toEqual([SpanStatusCode.ERROR]);
  });

  it.each(['promise', 'event', 'both'] as const)(
    '取消 %s 终态只记一次且 span 非 ERROR',
    async (source) => {
      const gate = deferred();
      updater.downloadUpdate.mockReturnValue(gate.promise);
      service.start({ autoCheckEnabled: () => false });
      updater.emit('update-available', { version: '2.0.0' });
      await vi.advanceTimersByTimeAsync(0);
      if (source !== 'event') service.cancelDownload();
      if (source !== 'promise') {
        updater.emit('update-cancelled', { version: '2.0.0' });
        updater.emit('update-cancelled', { version: '2.0.0' });
      }
      gate.reject(new Error('cancelled'));
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      expectDownload('cancelled');
      expect(
        spanExporter
          .getFinishedSpans()
          .filter((s) => s.name === 'update.download')
          .map((s) => s.status.code),
      ).toEqual([SpanStatusCode.OK]);
    },
  );

  it('基线检查前取消也有耗时样本，不调用下载且 span 非 ERROR', async () => {
    const gate = deferred();
    readFile.mockReturnValueOnce(gate.promise);
    service.start({ autoCheckEnabled: () => false });
    updater.emit('update-available', { version: '2.0.0' });
    service.cancelDownload();
    await vi.advanceTimersByTimeAsync(20);
    gate.resolve('');
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expectDownload('cancelled');
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(spanExporter.getFinishedSpans()[0]?.status.code).toBe(SpanStatusCode.OK);
  });

  it('旧 attempt 的迟到 reject 不清理或记录新 attempt', async () => {
    const old = deferred();
    const next = deferred();
    updater.downloadUpdate.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    service.start({ autoCheckEnabled: () => false });
    updater.emit('update-available', { version: '2.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    updater.emit('error', new Error('first failure'));
    updater.emit('update-available', { version: '3.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    old.reject(new Error('late failure'));
    service.cancelDownload();
    next.reject(new Error('cancelled'));
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(
      metric('app.update.download.duration')?.dataPoints.map((p) => [p.attributes, p.value]),
    ).toEqual([
      [{ outcome: 'error' }, expect.objectContaining({ count: 1 })],
      [{ outcome: 'cancelled' }, expect.objectContaining({ count: 1 })],
    ]);
    expect(service.getStatus().snapshot).toMatchObject({ phase: 'cancelled', version: '3.0.0' });
  });
});
