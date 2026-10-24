import {
  OBSERVABILITY_METRIC_DEFINITIONS,
  type ObservabilityMetricName,
} from '@code-agent/shared/observability';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { EventLoopLagMonitor } from './event-loop-lag';
import {
  initOtelMetrics,
  isOtelMetricsEnabled,
  recordDbBackup,
  recordDbRecovery,
  recordEventLoopDelay,
  recordIpcRequest,
  recordMemoryGrowth,
  recordRendererCrash,
  recordStartupPhase,
  recordUpdateCheck,
  recordUpdateDownload,
  recordUpdateEvent,
  recordWebVital,
  resetOtelMetrics,
} from './otel-metrics';

let exporter: InMemoryMetricExporter;
let provider: MeterProvider;

function metric(name: ObservabilityMetricName): MetricData {
  const found = exporter
    .getMetrics()
    .flatMap((r) => r.scopeMetrics)
    .flatMap((s) => s.metrics)
    .find((m) => m.descriptor.name === name);
  if (found === undefined) throw new Error(`Missing metric: ${name}`);
  return found;
}

beforeEach(() => {
  resetOtelMetrics();
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
  });
  initOtelMetrics(provider.getMeter('test-meter'));
});

afterEach(async () => {
  resetOtelMetrics();
  await provider.shutdown();
});

describe('otel-metrics', () => {
  it('未初始化时所有记录函数为 no-op', () => {
    resetOtelMetrics();
    expect(isOtelMetricsEnabled()).toBe(false);
    expect(recordWebVital('LCP', 1000)).toBe(false);
    expect(() => {
      recordIpcRequest('app:getInfo', 'success', 10);
      recordStartupPhase('services', 10);
      recordUpdateEvent('checking');
      recordUpdateCheck('launch', 'success', 10);
      recordUpdateDownload('downloaded', 10);
      recordEventLoopDelay(5);
      recordMemoryGrowth(10, 60);
      recordDbRecovery('healthy');
      recordDbBackup('success', 10);
      recordRendererCrash('crashed');
    }).not.toThrow();
  });

  it('IPC counter/histogram 成对记录四类低基数属性，缺省错误保守归 system', async () => {
    recordIpcRequest('app:getInfo', 'success', 12);
    recordIpcRequest('app:getInfo', 'error', 34);
    recordIpcRequest('app:getInfo', 'error', 5, 'business');
    recordIpcRequest('app:getInfo', 'error', 2, 'validation');
    await provider.forceFlush();
    const attributes = ['none', 'system', 'business', 'validation'].map((failureClass) => ({
      channel: 'app:getInfo',
      outcome: failureClass === 'none' ? 'success' : 'error',
      failureClass,
    }));
    expect(metric('ipc.server.requests').dataPoints.map((p) => p.attributes)).toEqual(attributes);
    expect(metric('ipc.server.requests').dataPoints.map((p) => p.value)).toEqual([1, 1, 1, 1]);
    expect(metric('ipc.server.request.duration').dataPoints.map((p) => p.attributes)).toEqual(
      attributes,
    );
    expect(metric('ipc.server.request.duration').dataPoints.map((p) => p.value)).toEqual(
      [12, 34, 5, 2].map((sum) => expect.objectContaining({ count: 1, sum })),
    );
  });

  it('100 次有效检查 10 次失败，错误率为 .1 而非漏斗事件比例', async () => {
    for (let i = 0; i < 100; i += 1) {
      recordUpdateEvent('checking');
      recordUpdateEvent(i < 10 ? 'error' : 'not-available');
      recordUpdateCheck('manual', i < 10 ? 'error' : 'success', 20);
    }
    await provider.forceFlush();
    const checks = metric('app.update.checks');
    expect(checks.dataPoints).toEqual([
      expect.objectContaining({ attributes: { trigger: 'manual', outcome: 'error' }, value: 10 }),
      expect.objectContaining({ attributes: { trigger: 'manual', outcome: 'success' }, value: 90 }),
    ]);
    const total = checks.dataPoints.reduce((sum, p) => sum + Number(p.value), 0);
    expect(Number(checks.dataPoints[0]?.value) / total).toBe(0.1);
    expect(metric('app.update.check.duration').dataPoints.map((p) => p.value)).toEqual([
      expect.objectContaining({ count: 10, sum: 200 }),
      expect.objectContaining({ count: 90, sum: 1800 }),
    ]);
  });

  it('低延迟窗口仍进入 window p99 分布，不依赖 onLag', async () => {
    let ns = 5e6;
    const onLag = vi.fn();
    const monitor = new EventLoopLagMonitor({
      createHistogram: () => ({
        enable: () => true,
        disable: () => true,
        reset: () => {},
        percentile: () => ns,
      }),
      onSample: (sample) => recordEventLoopDelay(sample.lagMs),
      onLag,
    });
    monitor.sample();
    ns = 10e6;
    monitor.sample();
    await provider.forceFlush();
    expect(onLag).not.toHaveBeenCalled();
    expect(metric('nodejs.eventloop.delay').dataPoints[0]).toMatchObject({
      attributes: {},
      value: { count: 2, sum: 15 },
    });
    monitor.stop();
  });

  it('启动 mode 与崩溃 recovery 保留默认值和显式值，reason 仍白名单化', async () => {
    recordStartupPhase('services', 120);
    recordStartupPhase('renderer-ready', 80, 'hidden');
    recordRendererCrash('crashed');
    recordRendererCrash('not-a-real-reason', 'stopped');
    await provider.forceFlush();
    expect(metric('app.startup.duration').dataPoints.map((p) => p.attributes)).toEqual([
      { phase: 'services', mode: 'foreground' },
      { phase: 'renderer-ready', mode: 'hidden' },
    ]);
    expect(metric('app.renderer.crashes').dataPoints.map((p) => p.attributes)).toEqual([
      { reason: 'crashed', recovery: 'reload' },
      { reason: 'unknown', recovery: 'stopped' },
    ]);
    expect(metric('app.renderer.crashes').dataPoints.map((p) => p.value)).toEqual([1, 1]);
  });

  it('所有 instrument 的实际导出单位与共享定义一致', async () => {
    recordIpcRequest('app:getInfo', 'success', 10);
    recordStartupPhase('window', 120);
    recordUpdateEvent('available');
    recordUpdateCheck('retry', 'success', 90);
    recordUpdateDownload('downloaded', 5000);
    recordEventLoopDelay(12);
    recordMemoryGrowth(180, 180);
    recordDbRecovery('rebuilt');
    recordDbBackup('error', 80);
    recordRendererCrash('oom');
    for (const name of ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const) recordWebVital(name, 1);
    await provider.forceFlush();
    for (const name of Object.keys(OBSERVABILITY_METRIC_DEFINITIONS) as ObservabilityMetricName[]) {
      expect(metric(name).descriptor.unit, name).toBe(OBSERVABILITY_METRIC_DEFINITIONS[name].unit);
    }
    expect(metric('nodejs.eventloop.delay').dataPoints[0]?.value).toMatchObject({
      count: 1,
      sum: 12,
    });
    expect(metric('app.db.recovery').dataPoints[0]?.attributes).toEqual({ outcome: 'rebuilt' });
    expect(metric('app.db.backup.duration').dataPoints[0]?.value).toMatchObject({
      count: 1,
      sum: 80,
    });
  });

  it('Web Vitals 与 observable gauge 实际采集值及属性正确', async () => {
    recordWebVital('LCP', 2500, { rating: 'good', navigationType: 'navigate' });
    await provider.forceFlush();
    expect(metric('web_vitals.lcp').dataPoints[0]).toMatchObject({
      attributes: { rating: 'good', 'navigation.type': 'navigate' },
      value: { count: 1, sum: 2500 },
    });
    expect(metric('process.memory.usage').dataPoints).toHaveLength(5);
    expect(metric('electron.process.memory').dataPoints[0]).toMatchObject({
      attributes: { 'process.type': 'Browser', 'process.name': 'main' },
      value: 1024 * 1024,
    });
    expect(metric('electron.process.cpu').dataPoints[0]?.value).toBe(1.5);
  });
});
