import assert from 'node:assert/strict';
import { isAbsolute, win32 } from 'node:path';
import type { TelemetryStatusRes, TelemetryTestConnectionRes } from '@code-agent/shared/main';
import {
  type JsonRecord,
  jsonRecord,
  otlpAttributes,
  type SmokeMetric,
  type SmokeRecord,
  type SmokeSnapshot,
  validId,
} from './observability-smoke-receiver';

export const SMOKE_SERVICE_NAME = 'observability-smoke';

export type SmokeLevel = 'off' | 'error-only' | 'full';

export interface SmokeEnvironmentOptions {
  readonly endpoint: string;
  readonly userData: string;
}

export function buildSmokeEnv(
  inherited: NodeJS.ProcessEnv,
  options: SmokeEnvironmentOptions,
): Record<string, string> {
  const url = new URL(options.endpoint);
  assert(
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '',
    'local endpoint required',
  );
  assert(
    url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '',
    'bare local endpoint required',
  );
  assert(
    isAbsolute(options.userData) || win32.isAbsolute(options.userData),
    'absolute userData required',
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined || /^(?:SENTRY_|OTEL_|VITEST)/i.test(key)) continue;
    if (
      /^(?:ELECTRON_RUN_AS_NODE|ELECTRON_RENDERER_URL|NODE_OPTIONS|NODE_ENV|APP_ENV_FILE|APP_USER_DATA|APP_DEBUG_PORT|APP_SKIP_CLOSE_GUARD|APP_DEV_UPDATE|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i.test(
        key,
      )
    )
      continue;
    env[key] = value;
  }
  return Object.assign(env, {
    ['NODE_ENV']: 'development',
    ['APP_ENV_FILE']: '',
    ['APP_USER_DATA']: options.userData,
    ['APP_DEBUG_PORT']: '0',
    ['APP_SKIP_CLOSE_GUARD']: '1',
    ['APP_DEV_UPDATE']: '0',
    ['NO_PROXY']: '127.0.0.1,localhost',
    ['SENTRY_DSN']: `http://smoke@127.0.0.1:${url.port}/1`,
    ['SENTRY_ENVIRONMENT']: 'local-smoke',
    ['SENTRY_RELEASE']: 'local-smoke@0.0.0',
    ['OTEL_EXPORTER_OTLP_ENDPOINT']: url.origin,
    ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']: `${url.origin}/v1/traces`,
    ['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT']: `${url.origin}/v1/metrics`,
    ['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']: `${url.origin}/v1/logs`,
    ['OTEL_SERVICE_NAME']: SMOKE_SERVICE_NAME,
    ['OTEL_TRACES_SAMPLER']: 'always_on',
    ['OTEL_TRACES_SAMPLER_ARG']: '1',
    ['OTEL_METRIC_EXPORT_INTERVAL']: '1000',
    ['OTEL_LOG_LEVEL']: 'info',
    ['OTEL_LOG_SAMPLE_RATIO']: '1',
    ['OTEL_LOG_MAX_PER_MINUTE']: '0',
  });
}

export interface SmokeExpectation {
  readonly level: SmokeLevel;
  readonly marker: string;
}

function attrsMatch(data: JsonRecord, expected: JsonRecord): boolean {
  const attributes = otlpAttributes(data['attributes']);
  return Object.entries(expected).every(([key, value]) => attributes[key] === value);
}

function spanTimes(data: JsonRecord): readonly [bigint, bigint] {
  const start = data['startTimeUnixNano'];
  const end = data['endTimeUnixNano'];
  assert(typeof start === 'string' && /^\d+$/.test(start), 'span start timestamp required');
  assert(typeof end === 'string' && /^\d+$/.test(end), 'span end timestamp required');
  assert(BigInt(start) > 0n && BigInt(end) >= BigInt(start), 'invalid span duration');
  return [BigInt(start), BigInt(end)];
}

function assertSpan(data: JsonRecord): void {
  assert(validId(data['traceId'], 32) && validId(data['spanId'], 16), 'invalid trace/span ID');
  assert.equal(jsonRecord(data['status'])['code'], 1, 'span must finish OK');
  spanTimes(data);
}

function assertStartup(spans: readonly SmokeRecord[]): void {
  const roots = spans.filter(({ data }) => data['name'] === 'app.startup');
  assert.equal(roots.length, 1, 'exactly one app.startup root required');
  const root = roots[0]?.data;
  assert(root);
  assertSpan(root);
  assert(
    [undefined, '', '0000000000000000'].includes(root['parentSpanId'] as string | undefined),
    'startup must be a root',
  );
  assert(attrsMatch(root, { 'startup.mode': 'foreground' }), 'startup must be foreground');
  const events = root['events'];
  assert(
    Array.isArray(events) && events.some((event) => jsonRecord(event)['name'] === 'renderer-ready'),
    'startup renderer-ready event missing',
  );
  const [start, end] = spanTimes(root);
  const spanIds = new Set([root['spanId']]);
  for (const name of ['db.init', 'window.create']) {
    const child = spans.find(({ data }) => data['name'] === name)?.data;
    assert(child, `missing ${name} span`);
    assertSpan(child);
    assert.equal(child['traceId'], root['traceId'], `${name} trace ID mismatch`);
    assert.equal(child['parentSpanId'], root['spanId'], `${name} parent mismatch`);
    assert(!spanIds.has(child['spanId']), `${name} reuses startup span ID`);
    spanIds.add(child['spanId']);
    const [childStart, childEnd] = spanTimes(child);
    assert(childStart >= start && childEnd <= end, `${name} outside startup interval`);
  }
  const ipc = spans.find(
    ({ data }) =>
      data['name'] === 'ipc settings:getAll' &&
      attrsMatch(data, { 'rpc.method': 'settings:getAll' }),
  );
  assert(ipc, 'settings:getAll IPC span missing');
  assertSpan(ipc.data);
}

function metricPoint(
  metrics: readonly SmokeMetric[],
  name: string,
  expected: JsonRecord,
): SmokeMetric {
  const metric = metrics.find(
    (candidate) => candidate.name === name && attrsMatch(candidate.data, expected),
  );
  assert(metric, `missing metric point ${name} with required attributes`);
  return metric;
}

function assertHistogram(metric: SmokeMetric, unit: string, sum?: number): void {
  assert.equal(metric.kind, 'histogram', `${metric.name} must be a histogram`);
  assert.equal(metric.unit, unit, `${metric.name} unit mismatch`);
  assert(Number(metric.data['count']) > 0, `${metric.name} has no observations`);
  const actual = metric.data['sum'];
  assert(
    typeof actual === 'number' && Number.isFinite(actual) && actual > 0,
    `${metric.name} sum missing`,
  );
  if (sum !== undefined) {
    assert.equal(
      Number(metric.data['count']),
      1,
      `${metric.name} must contain one synthetic sample`,
    );
    assert(Math.abs(actual - sum) < 1e-9, `${metric.name} value mismatch`);
  }
}

function assertCounter(metric: SmokeMetric): void {
  assert.equal(metric.kind, 'sum', `${metric.name} must be a sum`);
  assert.equal(metric.unit, '1', `${metric.name} unit mismatch`);
  const value = metric.data['asDouble'] ?? metric.data['asInt'];
  assert(Number.isFinite(Number(value)) && Number(value) >= 1, `${metric.name} counter missing`);
}

function assertMetrics(metrics: readonly SmokeMetric[]): void {
  assertHistogram(
    metricPoint(metrics, 'app.startup.duration', { phase: 'renderer-ready', mode: 'foreground' }),
    'ms',
  );
  assertCounter(metricPoint(metrics, 'app.db.recovery', { outcome: 'healthy' }));
  assertCounter(
    metricPoint(metrics, 'ipc.server.requests', {
      channel: 'settings:getAll',
      outcome: 'success',
      failureClass: 'none',
    }),
  );
  const attributes = { rating: 'good', 'navigation.type': 'smoke' };
  assertHistogram(metricPoint(metrics, 'web_vitals.lcp', attributes), 'ms', 2500);
  assertHistogram(metricPoint(metrics, 'web_vitals.cls', attributes), '1', 0.05);
}

function assertSyntheticError(snapshot: SmokeSnapshot, marker: string): void {
  const log = snapshot.logs.find(({ data }) =>
    attrsMatch(data, {
      'log.smokeId': marker,
      'log.scope': 'renderer.error',
      'process.type': 'renderer',
    }),
  );
  assert(log, 'synthetic renderer error log missing');
  assert.equal(log.data['severityNumber'], 17, 'synthetic log must be ERROR');
  assert.equal(
    jsonRecord(log.data['body'])['stringValue'],
    '渲染层错误上报',
    'unexpected error log body',
  );
  const attributes = otlpAttributes(log.data['attributes']);
  assert.equal(attributes['exception.type'], 'SmokeSyntheticError');
  assert.equal(
    attributes['exception.message'],
    `${marker} password=[REDACTED]`,
    'error message was lost or not redacted',
  );
  assert.equal(attributes['log.password'], '[REDACTED]', 'sensitive log attribute not redacted');
  const event = snapshot.events.find(
    (candidate) => jsonRecord(candidate['tags'] ?? {})['smokeId'] === marker,
  );
  assert(event, 'local synthetic Sentry event missing');
  assert(validId(event['event_id'], 32), 'invalid Sentry event ID');
  const tags = jsonRecord(event['tags']);
  assert.equal(tags['error.source'], 'renderer');
  assert.equal(tags['password'], '[REDACTED]', 'sensitive Sentry tag not redacted');
  assert(
    typeof attributes['app.trace_id'] === 'string' && attributes['app.trace_id'] !== '',
    'IPC correlation ID missing',
  );
  assert.equal(
    tags['app.trace_id'],
    attributes['app.trace_id'],
    'Sentry/log IPC correlation mismatch',
  );
  const exceptions = jsonRecord(event['exception'])['values'];
  assert(
    Array.isArray(exceptions) &&
      exceptions.some((value) => {
        const exception = jsonRecord(value);
        return (
          exception['type'] === 'SmokeSyntheticError' &&
          exception['value'] === `${marker} password=[REDACTED]`
        );
      }),
    'synthetic Sentry exception missing or not redacted',
  );
}

export function assertSmokeSignals(snapshot: SmokeSnapshot, expected: SmokeExpectation): void {
  assert.equal(snapshot.rejected, 0, `receiver rejected payloads: ${snapshot.issues.join(', ')}`);
  assert.equal(snapshot.leaked, false, 'synthetic sensitive value leaked in received body');
  if (expected.level === 'off') {
    assert.equal(snapshot.totalRequests, 0, 'off emitted network requests in this round');
    return;
  }
  for (const record of [...snapshot.spans, ...snapshot.metrics, ...snapshot.logs]) {
    assert.equal(record.resource['service.name'], SMOKE_SERVICE_NAME, 'unexpected OTLP resource');
    assert(record.scope.length > 0, 'missing instrumentation scope');
  }
  assertSyntheticError(snapshot, expected.marker);
  if (expected.level === 'error-only') {
    assert.equal(snapshot.requests.traces, 0, 'error-only emitted traces');
    assert.equal(snapshot.requests.metrics, 0, 'error-only emitted metrics');
    assert(
      snapshot.logs.every(
        ({ data }) => typeof data['severityNumber'] === 'number' && data['severityNumber'] >= 17,
      ),
      'error-only emitted non-error logs',
    );
    return;
  }
  assertStartup(snapshot.spans);
  assertMetrics(snapshot.metrics);
}

export interface SmokeStatusExpectation {
  readonly level: SmokeLevel;
  readonly since: number;
  readonly requireHealth: boolean;
}

export function assertSmokeStatus(
  status: TelemetryStatusRes,
  expected: SmokeStatusExpectation,
): void {
  const enabled = expected.level !== 'off';
  const full = expected.level === 'full';
  assert.equal(status.level, expected.level, 'runtime level mismatch');
  assert.equal(status.configuredLevel, expected.level, 'configured level mismatch');
  assert.equal(status.restartRequired, false, 'unexpected restart required');
  assert.equal(status.sentry.enabled, enabled, 'Sentry runtime enabled mismatch');
  assert.equal(status.sentry.initialized, enabled, 'Sentry initialization mismatch');
  assert.equal(status.otel.enabled, enabled, 'OTel runtime enabled mismatch');
  assert.equal(status.otel.tracing, full, 'trace runtime mismatch');
  assert.equal(status.otel.metrics, full, 'metric runtime mismatch');
  assert.equal(status.otel.logs, enabled, 'log runtime mismatch');
  for (const [signal, active] of [
    ['traces', full],
    ['metrics', full],
    ['logs', enabled],
  ] as const) {
    const health = status.health[signal];
    assert.equal(health.failures, 0, `${signal} export failures`);
    if (active && expected.requireHealth) {
      assert(health.attempts > 0, `${signal} health attempts missing`);
      assert(
        health.lastSuccessAt !== null && health.lastSuccessAt >= expected.since,
        `${signal} health not updated`,
      );
    } else if (!active) {
      assert.equal(health.attempts, 0, `${signal} inactive exporter ran`);
      assert.equal(health.lastSuccessAt, null, `${signal} inactive success recorded`);
    }
  }
  assert.equal(status.health.sampledLogs, 0, 'unexpected sampled logs');
  assert.equal(status.health.rateLimitedLogs, 0, 'unexpected rate-limited logs');
  assert.equal(status.health.suppressedErrors, 0, 'unexpected suppressed errors');
}

export function assertSmokeConnection(result: TelemetryTestConnectionRes, endpoint: string): void {
  assert(result.sentry.configured && result.sentry.valid, 'local Sentry DSN validation failed');
  assert(result.otlp.checked && result.otlp.reason === 'probed', 'OTLP probe did not run');
  assert.equal(result.otlp.results.length, 3, 'three OTLP probe results required');
  for (const signal of ['traces', 'metrics', 'logs'] as const) {
    const probe = result.otlp.results.find((item) => item.signal === signal);
    assert(probe?.ok && probe.statusCode === 200, `${signal} probe failed`);
    assert.equal(probe.url, `${endpoint}/v1/${signal}`, `${signal} probe used unexpected endpoint`);
  }
}

export async function withSmokeTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = (): void => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error(`${label}: interrupted`));
        timer = setTimeout(
          () => reject(new Error(`${label}: timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function runCheckedSmoke(
  action: () => Promise<void>,
  cleanups: readonly (() => Promise<void>)[],
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await action();
  } catch (error) {
    errors.push(error);
  }
  for (const cleanup of cleanups) {
    try {
      await withSmokeTimeout(Promise.resolve().then(cleanup), 15_000, 'cleanup');
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'smoke failed (assertion, IPC, timeout, or cleanup)');
}
