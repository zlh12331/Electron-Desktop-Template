import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppMetrics: () => [
      {
        type: 'Browser',
        name: 'main',
        memory: { workingSetSize: 1024 },
        cpu: { percentCPUUsage: 1.5 },
      },
    ],
  },
}));

import {
  initOtelMetrics,
  isOtelMetricsEnabled,
  recordEventLoopDelay,
  recordIpcRequest,
  recordMemoryGrowth,
  recordStartupPhase,
  recordUpdateCheck,
  recordUpdateDownload,
  recordUpdateEvent,
  recordWebVital,
  resetOtelMetrics,
} from './otel-metrics';

let exporter: InMemoryMetricExporter;
let provider: MeterProvider;

function metricNames(): string[] {
  return exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .map((metric) => metric.descriptor.name);
}

beforeEach(async () => {
  resetOtelMetrics();
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
  });
  initOtelMetrics(provider.getMeter('test-meter'));
});

describe('otel-metrics', () => {
  it('未初始化时记录函数均为 no-op，Web Vitals 返回 false', () => {
    resetOtelMetrics();
    expect(isOtelMetricsEnabled()).toBe(false);
    expect(recordWebVital('LCP', 1000)).toBe(false);
    expect(() => {
      recordIpcRequest('app:getInfo', 'success', 10);
      recordStartupPhase('services', 10);
      recordUpdateEvent('checking');
      recordUpdateCheck('launch', 'accepted', 10);
      recordUpdateDownload('downloaded', 10);
      recordEventLoopDelay(5);
      recordMemoryGrowth(10, 60);
    }).not.toThrow();
  });

  it('IPC 指标：counter + histogram 均带 channel/outcome', async () => {
    recordIpcRequest('app:getInfo', 'success', 12);
    recordIpcRequest('app:getInfo', 'error', 34);
    await provider.forceFlush();

    const names = metricNames();
    expect(names).toContain('ipc.server.requests');
    expect(names).toContain('ipc.server.request.duration');
    expect(names).toContain('process.memory.usage');

    const requests = exporter
      .getMetrics()
      .flatMap((r) => r.scopeMetrics)
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === 'ipc.server.requests');
    expect(requests?.dataPoints).toHaveLength(2);
  });

  it('启动/更新/事件循环/内存指标全部注册并记录', async () => {
    recordStartupPhase('services', 120);
    recordUpdateEvent('available');
    recordUpdateCheck('launch', 'accepted', 90);
    recordUpdateDownload('downloaded', 5000);
    recordEventLoopDelay(120);
    recordMemoryGrowth(180, 180);
    await provider.forceFlush();

    const names = metricNames();
    expect(names).toEqual(
      expect.arrayContaining([
        'app.startup.duration',
        'app.update.events',
        'app.update.check.duration',
        'app.update.download.duration',
        'nodejs.eventloop.delay',
        'nodejs.memory.growth',
      ]),
    );
  });

  it('Web Vitals：按指标名分流 histogram，rating/navigation 进属性', async () => {
    expect(recordWebVital('LCP', 2500, { rating: 'good', navigationType: 'navigate' })).toBe(true);
    expect(recordWebVital('CLS', 0.05)).toBe(true);
    await provider.forceFlush();

    const names = metricNames();
    expect(names).toContain('web_vitals.lcp');
    expect(names).toContain('web_vitals.cls');
    const lcp = exporter
      .getMetrics()
      .flatMap((r) => r.scopeMetrics)
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === 'web_vitals.lcp');
    expect(lcp?.dataPoints[0]?.attributes).toMatchObject({
      rating: 'good',
      'navigation.type': 'navigate',
    });
  });

  it('observable gauge：主进程内存与 Electron 进程指标在采集时求值', async () => {
    await provider.forceFlush();
    const names = metricNames();
    expect(names).toContain('process.memory.usage');
    expect(names).toContain('electron.process.memory');
    expect(names).toContain('electron.process.cpu');
  });
});
