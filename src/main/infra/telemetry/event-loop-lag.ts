// event-loop-lag.ts：主进程事件循环延迟监控——窗口分位数（默认 p99），不是全部延迟的总体 p99
// 正常窗口也参与采样，避免分布只包含触发告警的高延迟窗口。
import { monitorEventLoopDelay } from 'node:perf_hooks';

// 采样 5s 一档；p99 超 1s 判为「阻塞」；1e6 纳秒/毫秒换算
const DEFAULT_INTERVAL_MS = 5_000;

const DEFAULT_WARN_THRESHOLD_MS = 1_000;

const DEFAULT_PERCENTILE = 99;

const NS_PER_MS = 1e6;

export interface EventLoopLagSample {
  readonly lagMs: number;
  readonly intervalMs: number;
  readonly exceeded: boolean;
  readonly at: number;
}

export type LagHandler = (sample: EventLoopLagSample) => void;

/** 直方图最小接口（createHistogram 注入缝：测试用 fake 替换 monitorEventLoopDelay） */
export interface LagHistogram {
  enable(): boolean;
  disable(): boolean;
  percentile(percentile: number): number;
  reset(): void;
}

function defaultHistogramFactory(): LagHistogram {
  return monitorEventLoopDelay();
}

export interface EventLoopLagMonitorOptions {
  readonly intervalMs?: number;
  readonly warnThresholdMs?: number;
  readonly percentile?: number;
  readonly onLag?: LagHandler;
  /** 保留正常窗口，避免指标分布仅剩超阈值的尾部。 */
  readonly onSample?: LagHandler;
  readonly createHistogram?: () => LagHistogram;
}

/**
 * 事件循环延迟监控器：定时取窗口分位数并 reset；有效样本走 onSample，超阈值另走 onLag
 *
 * timer unref：监控不阻止进程退出
 */
export class EventLoopLagMonitor {
  private readonly intervalMs: number;
  private readonly warnThresholdMs: number;
  private readonly percentile: number;
  private readonly createHistogram: () => LagHistogram;
  private handlers: LagHandler[] = [];
  private sampleHandlers: LagHandler[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly histogram: LagHistogram;

  constructor(options: EventLoopLagMonitorOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.warnThresholdMs = options.warnThresholdMs ?? DEFAULT_WARN_THRESHOLD_MS;
    this.percentile = options.percentile ?? DEFAULT_PERCENTILE;
    this.createHistogram = options.createHistogram ?? defaultHistogramFactory;
    this.histogram = this.createHistogram();
    if (options.onLag !== undefined) {
      this.handlers.push(options.onLag);
    }
    if (options.onSample !== undefined) {
      this.sampleHandlers.push(options.onSample);
    }
  }

  onSample(handler: LagHandler): () => void {
    this.sampleHandlers.push(handler);
    return () => {
      this.sampleHandlers = this.sampleHandlers.filter((h) => h !== handler);
    };
  }

  onLag(handler: LagHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.histogram.enable();
    const timer = setInterval(() => {
      this.sample();
    }, this.intervalMs);
    timer.unref();
    this.timer = timer;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.histogram.disable();
    }
  }

  sample(now = Date.now()): EventLoopLagSample {
    const lagMs = this.histogram.percentile(this.percentile) / NS_PER_MS;
    this.histogram.reset();
    const sample: EventLoopLagSample = {
      lagMs,
      intervalMs: this.intervalMs,
      exceeded: lagMs > this.warnThresholdMs,
      at: now,
    };
    // 非有限值和负值不是有效窗口分位数，不能污染分布或触发告警。
    if (!Number.isFinite(lagMs) || lagMs < 0) {
      return sample;
    }
    for (const handler of this.sampleHandlers) {
      handler(sample);
    }
    if (sample.exceeded) {
      for (const handler of this.handlers) {
        handler(sample);
      }
    }
    return sample;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
