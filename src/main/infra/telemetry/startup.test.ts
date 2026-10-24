import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }));

import {
  bindStartupWindow,
  recordStartupMilestone,
  recordStartupReady,
  stopStartupObservation,
  withStartupObservation,
} from './startup';

let exporter: InMemorySpanExporter;
let provider: TracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  trace.setGlobalTracerProvider(provider);
});

afterEach(async () => {
  stopStartupObservation();
  await provider.shutdown();
  trace.disable();
  context.disable();
  vi.useRealTimers();
});

describe('启动观测', () => {
  it('创建阶段属于同一根 trace，仅匹配主窗口两个就绪通知后结束', async () => {
    await withStartupObservation(0, 'foreground', async () => {
      const child = trace.getTracer('test').startSpan('db.init');
      child.end();
      bindStartupWindow(7);
      recordStartupMilestone('window');
    });
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['db.init']);
    expect(recordStartupReady(9, 'renderer-ready')).toBe(false);
    expect(recordStartupReady(7, 'renderer-ready')).toBe(true);
    expect(recordStartupReady(7, 'renderer-ready')).toBe(false);
    expect(recordStartupReady(7, 'ready-to-show')).toBe(true);
    const spans = exporter.getFinishedSpans();
    const root = spans.find((span) => span.name === 'app.startup');
    const child = spans.find((span) => span.name === 'db.init');
    expect(root?.attributes['startup.mode']).toBe('foreground');
    expect(child?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
    expect(child?.spanContext().traceId).toBe(root?.spanContext().traceId);
    expect(recordStartupReady(7, 'renderer-ready')).toBe(false);
  });

  it('隐藏启动单独标记，后续窗口不得覆盖首次窗口', async () => {
    await withStartupObservation(0, 'hidden', async () => {
      bindStartupWindow(3);
      bindStartupWindow(4);
    });
    expect(recordStartupReady(4, 'renderer-ready')).toBe(false);
    recordStartupReady(3, 'ready-to-show');
    recordStartupReady(3, 'renderer-ready');
    expect(exporter.getFinishedSpans()[0]?.attributes['startup.mode']).toBe('hidden');
  });

  it('初始化失败不吞原错，缺就绪信号会超时结束而非泄漏 span', async () => {
    const failure = new Error('db failed');
    await expect(
      withStartupObservation(0, 'foreground', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(exporter.getFinishedSpans()[0]?.status.message).toBe('startup-failed');
    vi.useFakeTimers();
    await withStartupObservation(0, 'foreground', async () => {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(exporter.getFinishedSpans()[1]?.status.message).toBe('startup-timeout');
  });
});
