// otel.ts：OpenTelemetry 初始化——trace（Batch + 采样）+ metrics（周期导出）+ logs（结构化日志）
// 边界：OTEL_EXPORTER_OTLP_ENDPOINT 未配置时打包版完整 no-op；dev 无端点只走 Console trace
// 信号分工：Sentry 负责错误聚合/原生崩溃；OTel 负责 trace/metrics/logs（Sentry 性能采样固定 0，避免双扣配额）
import { APP_ID, PRODUCT_NAME, type TelemetryLevel } from '@code-agent/shared/main';
import {
  DiagConsoleLogger,
  DiagLogLevel,
  diag,
  metrics,
  type Span,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { app } from 'electron';
import { logger, setLogSink } from '../../utils/logger';
import { readTelemetryLevelSync } from '../storage/telemetry-pref';
import { type OtelResolvedConfig, resolveOtelConfig } from './otel-config';
import { clearOtelLogSink, emitOtelLog, setOtelLogSink } from './otel-log';
import { initOtelMetrics, resetOtelMetrics } from './otel-metrics';

/** OTel 运行状态快照（诊断包展示；不含端点/请求头） */
export interface OtelRuntimeStatus {
  /** 启动时遥测级别 */
  readonly level: TelemetryLevel;
  /** 是否有任何信号完成初始化（dev console trace 也算） */
  readonly enabled: boolean;
  /** trace provider 是否注册 */
  readonly tracing: boolean;
  /** metrics provider 是否注册 */
  readonly metrics: boolean;
  /** logs provider 是否注册 */
  readonly logs: boolean;
  /** 是否配置了至少一个 OTLP 端点 */
  readonly endpointConfigured: boolean;
}

let tracer: Tracer | null = null;

let tracerProvider: NodeTracerProvider | null = null;

let meterProvider: MeterProvider | null = null;

let loggerProvider: LoggerProvider | null = null;

let initialized = false;

let activeLevel: TelemetryLevel = 'off';

let activeConfig: OtelResolvedConfig | null = null;

/** 退出善后各 provider 的 flush/shutdown 上限（超时不阻塞应用退出） */
const SHUTDOWN_TIMEOUT_MS = 3_000;

function getResource(config: OtelResolvedConfig): ReturnType<typeof resourceFromAttributes> {
  return resourceFromAttributes({
    'service.name': config.serviceName,
    'service.version': app.getVersion(),
    'service.namespace': APP_ID,
    // 新版语义约定 + SigNoz 当前仍读取的旧键，双写以保证自建后端能正确分组
    'deployment.environment.name': app.isPackaged ? 'production' : 'development',
    'deployment.environment': app.isPackaged ? 'production' : 'development',
    'host.arch': process.arch,
    'host.platform': process.platform,
    'process.runtime.name': 'node',
    'process.runtime.version': process.version,
  });
}

function initTracing(
  config: OtelResolvedConfig,
  resource: ReturnType<typeof resourceFromAttributes>,
): void {
  const exporter =
    config.traceEndpoint !== null
      ? new OTLPTraceExporter({
          url: config.traceEndpoint,
          ...(Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
        })
      : new ConsoleSpanExporter();
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(config.traceSampleRatio),
  });
  const provider = new NodeTracerProvider({
    resource,
    sampler,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();
  tracerProvider = provider;
  tracer = provider.getTracer(PRODUCT_NAME, app.getVersion());
}

function initMetrics(
  config: OtelResolvedConfig,
  resource: ReturnType<typeof resourceFromAttributes>,
): void {
  if (config.metricEndpoint === null) {
    return;
  }
  const exporter = new OTLPMetricExporter({
    url: config.metricEndpoint,
    ...(Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
  });
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: config.metricExportIntervalMs,
  });
  const provider = new MeterProvider({ resource, readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  meterProvider = provider;
  initOtelMetrics(provider.getMeter(PRODUCT_NAME, app.getVersion()));
}

function initLogs(
  config: OtelResolvedConfig,
  resource: ReturnType<typeof resourceFromAttributes>,
): void {
  if (config.logEndpoint === null) {
    return;
  }
  const exporter = new OTLPLogExporter({
    url: config.logEndpoint,
    ...(Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
  });
  const provider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter })],
  });
  logs.setGlobalLoggerProvider(provider);
  loggerProvider = provider;
  setOtelLogSink(provider.getLogger(PRODUCT_NAME, app.getVersion()), config.logMinLevel);
  setLogSink((level, context, message, error) => {
    emitOtelLog(level, context, message, error);
  });
}

/**
 * 初始化遥测（启动序列调用，须在 logger 之后）
 *
 * - 遥测 off / 打包版无端点：完整 no-op
 * - 任意信号初始化失败：该信号降级为 no-op，其余信号继续（遥测绝不能影响主流程）
 *
 * @param level 启动时读取的遥测级别（缺省重读 telemetry-pref，兼容旧调用）
 */
export function initTelemetry(level: TelemetryLevel = readTelemetryLevelSync()): void {
  if (initialized) {
    return;
  }
  activeLevel = level;
  if (level === 'off') {
    logger.info({}, 'OpenTelemetry 未初始化（遥测级别 = off）');
    return;
  }

  // 排障开关：OTEL_DIAG=1 时把 OTel SDK 的导出错误打到 stderr（默认关闭，避免日志噪音）
  if (process.env['OTEL_DIAG'] === '1') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  try {
    const config = resolveOtelConfig(process.env, { isPackaged: app.isPackaged, level });
    activeConfig = config;
    if (!config.enabled) {
      logger.info({}, 'OpenTelemetry 未初始化（打包版未配置 OTLP 端点）');
      return;
    }

    const resource = getResource(config);
    if (config.traceEndpoint !== null || config.consoleTracing) {
      initTracing(config, resource);
    }
    initMetrics(config, resource);
    initLogs(config, resource);
    initialized = true;

    if (config.consoleTracing) {
      logger.info({}, 'OpenTelemetry 初始化完成（Console exporter，dev only）');
    } else {
      logger.info(
        {
          tracing: tracer !== null,
          metrics: meterProvider !== null,
          logs: loggerProvider !== null,
          traceSampleRatio: config.traceSampleRatio,
        },
        'OpenTelemetry 初始化完成（OTLP exporter）',
      );
    }
  } catch (error) {
    logger.warn({ error }, 'OpenTelemetry 初始化失败，遥测退化为 no-op');
    // 部分信号可能已经注册为全局 provider：先解绑再异步关闭，避免泄漏半初始化实例
    clearOtelLogSink();
    setLogSink(null);
    resetOtelMetrics();
    const failedProviders = [tracerProvider, meterProvider, loggerProvider];
    tracer = null;
    tracerProvider = null;
    meterProvider = null;
    loggerProvider = null;
    trace.disable();
    metrics.disable();
    logs.disable();
    for (const provider of failedProviders) {
      if (provider !== null) {
        void provider.shutdown().catch(() => {});
      }
    }
    initialized = false;
  }
}

/** 取全局 tracer（trace 未启用为 null；withSpan 不依赖它，始终可用） */
export function getTracer(): Tracer | null {
  return tracer;
}

/** 当前 OTel 运行状态（诊断包与测试用） */
export function getTelemetryRuntimeStatus(): OtelRuntimeStatus {
  return {
    level: activeLevel,
    enabled: initialized,
    tracing: tracerProvider !== null,
    metrics: meterProvider !== null,
    logs: loggerProvider !== null,
    endpointConfigured:
      activeConfig !== null &&
      (activeConfig.traceEndpoint !== null ||
        activeConfig.metricEndpoint !== null ||
        activeConfig.logEndpoint !== null),
  };
}

/**
 * 包一段 span 执行异步操作：成功 OK，失败 ERROR + recordException 后原样抛出
 *
 * `isError` 用于把「已转成错误响应、不抛异常」的业务失败也标成 ERROR
 * （IPC 校验失败等场景），返回非空字符串即视为失败原因。
 * 未初始化时 `trace.getTracer` 返回 no-op tracer，fn 仍会收到可调用的 Span（不记录），
 * 调用方无需判空。
 *
 * @param name span 名（建议 `ipc {channel}` / `update.check` 形态）
 * @param attributes span 属性（基数必须有界）
 * @param fn 要包裹的异步操作
 * @param isError 响应级失败判定（可选）
 * @returns fn 的返回值
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
  isError?: (result: T) => string | null,
): Promise<T> {
  return trace.getTracer(PRODUCT_NAME).startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      const errorMessage = isError?.(result) ?? null;
      if (errorMessage === null) {
        span.setStatus({ code: SpanStatusCode.OK });
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      }
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : { message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** 给 Promise 加超时（超时只返回，不取消底层操作） */
async function withTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** 退出善后：先解绑日志 sink，再 flush/shutdown 三路 provider（单路失败只告警） */
export async function shutdownTelemetry(): Promise<void> {
  if (
    !initialized &&
    tracerProvider === null &&
    meterProvider === null &&
    loggerProvider === null
  ) {
    activeLevel = 'off';
    activeConfig = null;
    return;
  }

  clearOtelLogSink();
  setLogSink(null);
  tracer = null;

  const flushTasks: Promise<unknown>[] = [];
  if (tracerProvider !== null) {
    flushTasks.push(tracerProvider.forceFlush());
  }
  if (meterProvider !== null) {
    flushTasks.push(meterProvider.forceFlush());
  }
  if (loggerProvider !== null) {
    flushTasks.push(loggerProvider.forceFlush());
  }
  await Promise.allSettled(flushTasks.map((task) => withTimeout(task, SHUTDOWN_TIMEOUT_MS)));

  const shutdownTasks: Promise<unknown>[] = [];
  if (tracerProvider !== null) {
    shutdownTasks.push(tracerProvider.shutdown());
  }
  if (meterProvider !== null) {
    shutdownTasks.push(meterProvider.shutdown());
  }
  if (loggerProvider !== null) {
    shutdownTasks.push(loggerProvider.shutdown());
  }
  await Promise.allSettled(shutdownTasks.map((task) => withTimeout(task, SHUTDOWN_TIMEOUT_MS)));

  trace.disable();
  metrics.disable();
  logs.disable();
  resetOtelMetrics();
  tracerProvider = null;
  meterProvider = null;
  loggerProvider = null;
  activeConfig = null;
  activeLevel = 'off';
  initialized = false;
  logger.info({}, 'OpenTelemetry 已关闭');
}
