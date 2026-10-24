import type { TelemetryStatusRes } from '@code-agent/shared/main';
import type { JsonRecord, SmokeRecord, SmokeSnapshot } from './observability-smoke-receiver';

export const fixtureMarker = 'smoke-local-fixture';
export const fixtureSecret = 'synthetic-sensitive-value';
export const fixtureTraceId = '1234567890abcdef1234567890abcdef';

export function fixtureAttributes(values: JsonRecord): unknown[] {
  return Object.entries(values).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function record(data: JsonRecord): SmokeRecord {
  return { resource: { 'service.name': 'observability-smoke' }, scope: 'fixture', data };
}

export function smokeFixture(): SmokeSnapshot {
  const span = (name: string, spanId: string, parentSpanId?: string): SmokeRecord =>
    record({
      name,
      traceId: fixtureTraceId,
      spanId,
      ...(parentSpanId === undefined ? {} : { parentSpanId }),
      startTimeUnixNano: '100',
      endTimeUnixNano: '200',
      status: { code: 1 },
      attributes: fixtureAttributes({ 'startup.mode': 'foreground' }),
      events: [{ name: 'ready-to-show' }, { name: 'renderer-ready' }],
    });
  const metric = (name: string, kind: 'sum' | 'histogram', unit: string, data: JsonRecord) => ({
    ...record(data),
    name,
    kind,
    unit,
  });
  const root = '1111111111111111';
  return {
    totalRequests: 4,
    requests: { traces: 1, metrics: 1, logs: 1, sentry: 1 },
    records: { traces: 4, metrics: 5, logs: 1, sentry: 1 },
    rejected: 0,
    issues: [],
    leaked: false,
    spans: [
      span('app.startup', root),
      span('db.init', '2222222222222222', root),
      span('window.create', '3333333333333333', root),
      {
        ...span('ipc settings:getAll', '4444444444444444'),
        data: {
          ...span('ipc settings:getAll', '4444444444444444').data,
          attributes: fixtureAttributes({ 'rpc.method': 'settings:getAll' }),
        },
      },
    ],
    metrics: [
      metric('app.startup.duration', 'histogram', 'ms', {
        count: '1',
        sum: 100,
        attributes: fixtureAttributes({ phase: 'renderer-ready', mode: 'foreground' }),
      }),
      metric('app.db.recovery', 'sum', '1', {
        asDouble: 1,
        attributes: fixtureAttributes({ outcome: 'healthy' }),
      }),
      metric('ipc.server.requests', 'sum', '1', {
        asDouble: 1,
        attributes: fixtureAttributes({
          channel: 'settings:getAll',
          outcome: 'success',
          failureClass: 'none',
        }),
      }),
      metric('web_vitals.lcp', 'histogram', 'ms', {
        count: '1',
        sum: 2500,
        attributes: fixtureAttributes({ rating: 'good', 'navigation.type': 'smoke' }),
      }),
      metric('web_vitals.cls', 'histogram', '1', {
        count: '1',
        sum: 0.05,
        attributes: fixtureAttributes({ rating: 'good', 'navigation.type': 'smoke' }),
      }),
    ],
    logs: [
      record({
        severityNumber: 17,
        body: { stringValue: '渲染层错误上报' },
        attributes: fixtureAttributes({
          'log.scope': 'renderer.error',
          'process.type': 'renderer',
          'log.smokeId': fixtureMarker,
          'log.password': '[REDACTED]',
          'exception.type': 'SmokeSyntheticError',
          'exception.message': `${fixtureMarker} password=[REDACTED]`,
          'app.trace_id': 'smoke-ipc-id',
        }),
      }),
    ],
    events: [
      {
        ['event_id']: 'abcdef1234567890abcdef1234567890',
        tags: {
          smokeId: fixtureMarker,
          password: '[REDACTED]',
          'error.source': 'renderer',
          'app.trace_id': 'smoke-ipc-id',
        },
        exception: {
          values: [{ type: 'SmokeSyntheticError', value: `${fixtureMarker} password=[REDACTED]` }],
        },
      },
    ],
  };
}

export function statusFixture(level: 'off' | 'error-only' | 'full' = 'full'): TelemetryStatusRes {
  const health = {
    attempts: 1,
    failures: 0,
    lastSuccessAt: 100,
    lastFailureAt: null,
    lastError: null,
  };
  const zero = { ...health, attempts: 0, lastSuccessAt: null };
  return {
    level,
    configuredLevel: level,
    restartRequired: false,
    sentry: {
      enabled: level !== 'off',
      initialized: level !== 'off',
      reason: level === 'off' ? 'telemetry-off' : null,
      release: null,
      environment: null,
    },
    otel: {
      enabled: level !== 'off',
      tracing: level === 'full',
      metrics: level === 'full',
      logs: level !== 'off',
      endpointConfigured: level !== 'off',
    },
    health: {
      traces: level === 'full' ? health : zero,
      metrics: level === 'full' ? health : zero,
      logs: level === 'off' ? zero : health,
      sampledLogs: 0,
      rateLimitedLogs: 0,
      suppressedErrors: 0,
      lastDropAt: null,
    },
  };
}
