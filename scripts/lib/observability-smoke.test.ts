import { vi } from 'vitest';
import { unwrap } from '../../src/renderer/lib/ipc';
import {
  assertSmokeConnection,
  assertSmokeSignals,
  assertSmokeStatus,
  buildSmokeEnv,
  runCheckedSmoke,
  withSmokeTimeout,
} from './observability-smoke';
import { isSmokeMainPage, parseSmokeLevels, SMOKE_OBSERVATION_MS } from './observability-smoke-app';
import {
  fixtureAttributes,
  fixtureMarker,
  smokeFixture,
  statusFixture,
} from './observability-smoke-fixtures';

const expectation = { level: 'full' as const, marker: fixtureMarker };

describe('smoke acceptance', () => {
  it('accepts complete structured evidence, not request counts alone', () => {
    expect(() => assertSmokeSignals(smokeFixture(), expectation)).not.toThrow();
    expect(() =>
      assertSmokeStatus(statusFixture(), { level: 'full', since: 50, requireHealth: true }),
    ).not.toThrow();
  });

  it('fails when all counters are positive but a required marker is missing', () => {
    const snapshot = smokeFixture();
    expect(() =>
      assertSmokeSignals(
        { ...snapshot, spans: snapshot.spans.filter((span) => span.data['name'] !== 'db.init') },
        expectation,
      ),
    ).toThrow(/db.init/);
  });

  it.each([
    { traceId: 'wrong' },
    { spanId: '0000000000000000' },
    { spanId: '3333333333333333' },
    { traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { parentSpanId: '9999999999999999' },
    { endTimeUnixNano: '999' },
    { status: { code: 2 } },
  ])('rejects invalid child span evidence: %j', (change) => {
    const snapshot = smokeFixture();
    const spans = snapshot.spans.map((span) =>
      span.data['name'] === 'db.init' ? { ...span, data: { ...span.data, ...change } } : span,
    );
    expect(() => assertSmokeSignals({ ...snapshot, spans }, expectation)).toThrow();
  });

  it.each([
    { name: 'description contains app.startup.duration' },
    { unit: 's' },
    {
      data: {
        count: 0,
        sum: 100,
        attributes: fixtureAttributes({ phase: 'renderer-ready', mode: 'foreground' }),
      },
    },
    {
      data: {
        count: 1,
        sum: 100,
        attributes: fixtureAttributes({ phase: 'window', mode: 'foreground' }),
      },
    },
    {
      data: {
        count: 1,
        sum: 100,
        attributes: fixtureAttributes({ phase: 'renderer-ready', mode: 'hidden' }),
      },
    },
  ])('rejects invalid startup metric evidence: %j', (change) => {
    const snapshot = smokeFixture();
    const metrics = snapshot.metrics.map((metric) =>
      metric.name === 'app.startup.duration' ? { ...metric, ...change } : metric,
    );
    expect(() => assertSmokeSignals({ ...snapshot, metrics }, expectation)).toThrow();
  });

  it('checks actual Web Vital values and units', () => {
    const snapshot = smokeFixture();
    const metrics = snapshot.metrics.map((metric) =>
      metric.name === 'web_vitals.lcp' ? { ...metric, data: { ...metric.data, sum: 2.5 } } : metric,
    );
    expect(() => assertSmokeSignals({ ...snapshot, metrics }, expectation)).toThrow(
      /value mismatch/,
    );
  });

  it.each([
    { events: [] },
    { logs: [] },
    { leaked: true },
    { rejected: 1, issues: ['body limit'] },
  ])('fails incomplete or unsafe evidence: %j', (change) => {
    expect(() => assertSmokeSignals({ ...smokeFixture(), ...change }, expectation)).toThrow();
  });

  it('fails when a synthetic ID is only a key name, not the tag value', () => {
    const snapshot = smokeFixture();
    const events = snapshot.events.map((event) => ({
      ...event,
      tags: { [fixtureMarker]: 'smokeId' },
    }));
    expect(() => assertSmokeSignals({ ...snapshot, events }, expectation)).toThrow(
      /Sentry event missing/,
    );
  });

  it('requires health updates rather than only enabled flags', () => {
    expect(() =>
      assertSmokeStatus(statusFixture(), { level: 'full', since: 101, requireHealth: true }),
    ).toThrow(/health not updated/);
  });

  it('accepts error-only logs/Sentry but rejects traces, metrics and info logs', () => {
    const snapshot = {
      ...smokeFixture(),
      spans: [],
      metrics: [],
      requests: { traces: 0, metrics: 0, logs: 1, sentry: 1 },
    };
    const expected = { ...expectation, level: 'error-only' as const };
    expect(() => assertSmokeSignals(snapshot, expected)).not.toThrow();
    expect(() =>
      assertSmokeSignals({ ...snapshot, requests: { ...snapshot.requests, traces: 1 } }, expected),
    ).toThrow(/emitted traces/);
    expect(() =>
      assertSmokeSignals({ ...snapshot, requests: { ...snapshot.requests, metrics: 1 } }, expected),
    ).toThrow(/emitted metrics/);
    const info = {
      resource: { 'service.name': 'observability-smoke' },
      scope: 'fixture',
      data: { severityNumber: 9 },
    };
    expect(() =>
      assertSmokeSignals({ ...snapshot, logs: [...snapshot.logs, info] }, expected),
    ).toThrow(/non-error logs/);
    expect(() =>
      assertSmokeStatus(statusFixture('error-only'), {
        level: 'error-only',
        since: 50,
        requireHealth: true,
      }),
    ).not.toThrow();
  });

  it('off requires zero requests, including empty probes, and inactive health', () => {
    const snapshot = {
      ...smokeFixture(),
      totalRequests: 0,
      spans: [],
      metrics: [],
      logs: [],
      events: [],
      requests: { traces: 0, metrics: 0, logs: 0, sentry: 0 },
    };
    const expected = { ...expectation, level: 'off' as const };
    expect(() => assertSmokeSignals(snapshot, expected)).not.toThrow();
    expect(() => assertSmokeSignals({ ...snapshot, totalRequests: 1 }, expected)).toThrow(
      /off emitted network/,
    );
    expect(() =>
      assertSmokeStatus(statusFixture('off'), { level: 'off', since: 50, requireHealth: true }),
    ).not.toThrow();
    expect(() =>
      assertSmokeStatus(statusFixture(), { level: 'off', since: 50, requireHealth: true }),
    ).toThrow();
  });

  it('requires all actual local probe URLs and 200 statuses', () => {
    const result = {
      sentry: { configured: true, valid: true, message: 'fixture' },
      otlp: {
        checked: true,
        reason: 'probed' as const,
        message: 'fixture',
        results: (['traces', 'metrics', 'logs'] as const).map((signal) => ({
          signal,
          url: `http://127.0.0.1:12345/v1/${signal}`,
          ok: true,
          statusCode: 200,
          message: 'fixture',
        })),
      },
    };
    expect(() => assertSmokeConnection(result, 'http://127.0.0.1:12345')).not.toThrow();
    const results = result.otlp.results.map((item) => ({ ...item, statusCode: 503 }));
    expect(() =>
      assertSmokeConnection(
        { ...result, otlp: { ...result.otlp, results } },
        'http://127.0.0.1:12345',
      ),
    ).toThrow(/probe failed/);
    expect(() => assertSmokeConnection(result, 'http://127.0.0.1:12346')).toThrow(
      /unexpected endpoint/,
    );
  });

  it('never turns an IPC error into success after signal counts were met', async () => {
    await expect(
      runCheckedSmoke(async () => {
        assertSmokeSignals(smokeFixture(), expectation);
        unwrap({ error: { code: 'INVALID_INPUT', message: 'synthetic IPC failure' } });
      }, []),
    ).rejects.toThrow(/smoke failed/);
  });

  it('fails successful acceptance if cleanup fails and still runs later cleanups', async () => {
    const cleanups: string[] = [];
    await expect(
      runCheckedSmoke(async () => {
        assertSmokeSignals(smokeFixture(), expectation);
      }, [
        async () => {
          cleanups.push('app');
          throw new Error('synthetic close failure');
        },
        async () => {
          cleanups.push('receiver');
        },
      ]),
    ).rejects.toThrow(/smoke failed/);
    expect(cleanups).toEqual(['app', 'receiver']);
  });

  it('preserves action and cleanup failures together', async () => {
    const actionError = new Error('action failed');
    const cleanupError = new Error('cleanup failed');
    const result = runCheckedSmoke(async () => {
      throw actionError;
    }, [
      async () => {
        throw cleanupError;
      },
    ]);
    await expect(result).rejects.toMatchObject({ errors: [actionError, cleanupError] });
  });

  it('times out unresolved IPC and still cleans up', async () => {
    let cleaned = false;
    await expect(
      runCheckedSmoke(async () => {
        await withSmokeTimeout(new Promise(() => {}), 5, 'synthetic IPC');
      }, [
        async () => {
          cleaned = true;
        },
      ]),
    ).rejects.toThrow(/smoke failed/);
    expect(cleaned).toBe(true);
  });

  it('turns an interruption into failure, not a successful early result', async () => {
    const controller = new AbortController();
    const work = withSmokeTimeout(new Promise(() => {}), 10_000, 'fixture', controller.signal);
    controller.abort();
    await expect(work).rejects.toThrow(/interrupted/);
  });

  it('fails a hanging cleanup and continues the remaining cleanup steps', async () => {
    vi.useFakeTimers();
    let continued = false;
    try {
      const result = runCheckedSmoke(async () => {}, [
        async () => new Promise<void>(() => {}),
        async () => {
          continued = true;
        },
      ]);
      const assertion = expect(result).rejects.toThrow(/smoke failed/);
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
      expect(continued).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves only after successful cleanup', async () => {
    const sequence: string[] = [];
    await runCheckedSmoke(async () => {
      sequence.push('assertions');
    }, [
      async () => {
        sequence.push('cleanup');
      },
    ]);
    expect(sequence).toEqual(['assertions', 'cleanup']);
  });
});

describe('local smoke isolation', () => {
  it('replaces inherited signal endpoints and credentials without mutating the parent', () => {
    const inherited = {
      ['PATH']: 'keep-path',
      ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']: 'https://invalid.example/traces',
      ['otel_exporter_otlp_logs_endpoint']: 'https://invalid.example/logs',
      ['OTEL_EXPORTER_OTLP_HEADERS']: 'authorization=synthetic-old-value',
      ['SENTRY_AUTH_TOKEN']: 'synthetic-old-value',
      ['SENTRY_DSN']: 'https://old@invalid.example/9',
      ['SENTRY_UNKNOWN_FUTURE_OPTION']: 'old',
      ['ELECTRON_RUN_AS_NODE']: '1',
      ['ELECTRON_RENDERER_URL']: 'https://invalid.example',
      ['NODE_OPTIONS']: '--require=untrusted.js',
      ['APP_DEV_UPDATE']: '1',
      ['APP_ENV_FILE']: 'F:/private.env',
      ['HTTPS_PROXY']: 'https://invalid.example',
      ['VITEST']: 'true',
    };
    const env = buildSmokeEnv(inherited, {
      endpoint: 'http://127.0.0.1:12345',
      userData: 'F:/temporary/smoke-fixture',
    });
    expect(env).toMatchObject({
      ['PATH']: 'keep-path',
      ['OTEL_EXPORTER_OTLP_ENDPOINT']: 'http://127.0.0.1:12345',
      ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']: 'http://127.0.0.1:12345/v1/traces',
      ['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT']: 'http://127.0.0.1:12345/v1/metrics',
      ['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']: 'http://127.0.0.1:12345/v1/logs',
      ['SENTRY_DSN']: 'http://smoke@127.0.0.1:12345/1',
      ['APP_ENV_FILE']: '',
      ['APP_USER_DATA']: 'F:/temporary/smoke-fixture',
      ['APP_DEBUG_PORT']: '0',
      ['APP_DEV_UPDATE']: '0',
      ['NODE_ENV']: 'development',
      ['OTEL_TRACES_SAMPLER']: 'always_on',
      ['OTEL_TRACES_SAMPLER_ARG']: '1',
      ['OTEL_LOG_SAMPLE_RATIO']: '1',
      ['OTEL_LOG_MAX_PER_MINUTE']: '0',
    });
    for (const key of [
      'OTEL_EXPORTER_OTLP_HEADERS',
      'otel_exporter_otlp_logs_endpoint',
      'SENTRY_AUTH_TOKEN',
      'SENTRY_UNKNOWN_FUTURE_OPTION',
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_RENDERER_URL',
      'NODE_OPTIONS',
      'HTTPS_PROXY',
      'VITEST',
    ])
      expect(env).not.toHaveProperty(key);
    expect(inherited.SENTRY_AUTH_TOKEN).toBe('synthetic-old-value');
  });

  it.each([
    'https://127.0.0.1:1234',
    'http://localhost:1234',
    'http://invalid.example:1234',
    'http://127.0.0.1:1234/v1/traces',
    'http://old@127.0.0.1:1234',
  ])('rejects non-local or ambiguous endpoint %s', (endpoint) => {
    expect(() => buildSmokeEnv({}, { endpoint, userData: 'F:/temporary/smoke-fixture' })).toThrow();
  });

  it('defaults to all three levels and rejects unknown CLI flags', () => {
    expect(parseSmokeLevels([])).toEqual(['full', 'error-only', 'off']);
    expect(parseSmokeLevels(['--level=off'])).toEqual(['off']);
    expect(() => parseSmokeLevels(['--level=unknown'])).toThrow(/Usage/);
    expect(() => parseSmokeLevels(['--level=off', '--level=full'])).toThrow(/Usage/);
    expect(SMOKE_OBSERVATION_MS).toBeGreaterThan(5000);
  });

  it('ignores DevTools, blank pages and remote renderer URLs', () => {
    const rendererIndex = 'F:/TraeProjects/1/out/renderer/index.html';
    expect(
      isSmokeMainPage('file:///F:/TraeProjects/1/out/renderer/index.html#/', rendererIndex),
    ).toBe(true);
    for (const url of [
      'devtools://devtools/bundled/inspector.html',
      'about:blank',
      'https://invalid.example/renderer/index.html',
      'file:///F:/other/renderer/index.html',
    ]) {
      expect(isSmokeMainPage(url, rendererIndex)).toBe(false);
    }
  });
});
