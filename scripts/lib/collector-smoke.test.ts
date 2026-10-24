// biome-ignore-all lint/style/useNamingConvention: Assertions mirror upstream Collector/Compose YAML keys.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { configMount, DockerScope, RUNTIME_ARGS } from './collector-smoke-docker';
import {
  COLLECTOR_IMAGE,
  droppedTailTraces,
  makeBatch,
  missingMarkers,
  queueSizes,
  SIGNALS,
  SINK_CONFIG,
  STORAGE_INIT_IMAGE,
  zeroPercentTailFixture,
} from './collector-smoke-fixtures';

const configDir = resolve(import.meta.dirname, '../../observability/collector');
const readConfig = (name: string): string => readFileSync(resolve(configDir, name), 'utf8');

function queues(value: string, exporter = 'otlp_http/upstream'): string {
  return SIGNALS.map(
    (signal) =>
      `otelcol_exporter_queue_size{exporter="${exporter}",data_type="${signal}"} ${value}`,
  ).join('\n');
}

describe('Collector production configuration', () => {
  it('uses the supported exporter ID, persistent bounded queue and infinite bounded-backoff retries', () => {
    expect(load(readConfig('collector.yaml'))).toMatchObject({
      receivers: { otlp: { protocols: { http: { endpoint: '0.0.0.0:4318' } } } },
      extensions: {
        file_storage: {
          directory: '/var/lib/otelcol/file_storage',
          create_directory: true,
          fsync: true,
          max_size: 268435456,
        },
      },
      processors: {
        memory_limiter: { check_interval: '1s', limit_mib: 400, spike_limit_mib: 80 },
        batch: { timeout: '1s', send_batch_size: 256, send_batch_max_size: 512 },
      },
      exporters: {
        'otlp_http/upstream': {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Collector environment expansion, not JavaScript.
          endpoint: '${env:OTLP_UPSTREAM_ENDPOINT:-http://host.docker.internal:4318}',
          timeout: '5s',
          retry_on_failure: {
            enabled: true,
            initial_interval: '1s',
            max_interval: '5s',
            max_elapsed_time: '0s',
          },
          sending_queue: {
            enabled: true,
            storage: 'file_storage',
            sizer: 'requests',
            queue_size: 1000,
            num_consumers: 2,
            block_on_overflow: false,
          },
        },
      },
      service: {
        extensions: ['file_storage'],
        telemetry: {
          metrics: {
            readers: [{ pull: { exporter: { prometheus: { host: '0.0.0.0', port: 8888 } } } }],
          },
        },
        pipelines: Object.fromEntries(
          SIGNALS.map((signal) => [
            signal,
            {
              receivers: ['otlp'],
              processors: ['memory_limiter', 'batch'],
              exporters: ['otlp_http/upstream'],
            },
          ]),
        ),
      },
    });
  });

  it('publishes loopback only, pins images, initializes only its dedicated volume, and runs non-root', () => {
    expect(load(readConfig('compose.yaml'))).toMatchObject({
      services: {
        collector: {
          image: COLLECTOR_IMAGE,
          user: '10001:10001',
          read_only: true,
          cap_drop: ['ALL'],
          security_opt: ['no-new-privileges:true'],
          mem_limit: '512m',
          environment: { GOMEMLIMIT: '320MiB' },
          ports: ['127.0.0.1:14318:4318', '127.0.0.1:18888:8888'],
          command: ['--config=/etc/otelcol/collector.yaml'],
          volumes: [
            './collector.yaml:/etc/otelcol/collector.yaml:ro',
            './tail-sampling.yaml:/etc/otelcol/tail-sampling.yaml:ro',
            'queue:/var/lib/otelcol',
          ],
          depends_on: { 'storage-init': { condition: 'service_completed_successfully' } },
        },
        'storage-init': {
          image: STORAGE_INIT_IMAGE,
          network_mode: 'none',
          read_only: true,
          cap_drop: ['ALL'],
          cap_add: ['CHOWN', 'FOWNER'],
          volumes: ['queue:/var/lib/otelcol'],
        },
      },
      volumes: { queue: null },
    });
    expect(RUNTIME_ARGS).toContain('10001:10001');
    expect(RUNTIME_ARGS).toContain('--read-only');
    expect(readConfig('compose.yaml')).not.toContain('container_name:');
  });

  it('tail overlay changes ONLY traces and leaves the normal head-sampling default untouched', () => {
    const overlay = load(readConfig('tail-sampling.yaml'));
    expect(overlay).toEqual({
      processors: {
        tail_sampling: {
          decision_wait: '30s',
          num_traces: 5000,
          expected_new_traces_per_sec: 100,
          policies: [
            { name: 'errors', type: 'status_code', status_code: { status_codes: ['ERROR'] } },
            { name: 'slow', type: 'latency', latency: { threshold_ms: 1000 } },
            { name: 'baseline', type: 'probabilistic', probabilistic: { sampling_percentage: 10 } },
          ],
        },
      },
      service: {
        pipelines: { traces: { processors: ['memory_limiter', 'tail_sampling', 'batch'] } },
      },
    });
    const original = readConfig('tail-sampling.yaml');
    expect(load(zeroPercentTailFixture(original))).toEqual(
      load(original.replace('sampling_percentage: 10', 'sampling_percentage: 0')),
    );
    expect(readConfig('tail-sampling.yaml')).toBe(original);
  });

  it('rejects an ambiguous or outdated baseline instead of silently testing 10%', () => {
    expect(() => zeroPercentTailFixture('sampling_percentage: 20')).toThrow('Expected one');
    expect(() =>
      zeroPercentTailFixture('sampling_percentage: 10\nsampling_percentage: 10'),
    ).toThrow('Expected one');
  });

  it('sink uses the real OTLP receiver and detailed debug exporter without forwarding real data', () => {
    expect(load(SINK_CONFIG)).toMatchObject({
      exporters: { debug: { verbosity: 'detailed', sampling_thereafter: 1 } },
      service: {
        pipelines: Object.fromEntries(
          SIGNALS.map((signal) => [signal, { receivers: ['otlp'], exporters: ['debug'] }]),
        ),
      },
    });
    expect(SINK_CONFIG).not.toContain('env:');
    expect(SINK_CONFIG).not.toContain('upstream');
  });
});

describe('Synthetic evidence', () => {
  it('generates distinct identities for every sample, signal and wave', () => {
    const all = SIGNALS.flatMap((signal) => [
      makeBatch(signal, 'wave1', 256),
      makeBatch(signal, 'wave2', 256),
    ]);
    const markers = all.flatMap((batch) => batch.markers);
    expect(markers).toHaveLength(1536);
    expect(new Set(markers).size).toBe(markers.length);
    for (const batch of all) {
      const serialized = JSON.stringify(batch.body);
      for (const marker of batch.markers) expect(serialized).toContain(marker);
      expect(serialized).toContain('collector-smoke-synthetic');
    }
  });

  it.each(['normal', 'error', 'slow'] as const)(
    'generates sampled %s traces with valid trace IDs and duration',
    (kind) => {
      const body = makeBatch('traces', 'tail', 1, kind).body as {
        resourceSpans: {
          scopeSpans: {
            spans: {
              traceId: string;
              spanId: string;
              flags: number;
              startTimeUnixNano: string;
              endTimeUnixNano: string;
              status: { code: number };
            }[];
          }[];
        }[];
      };
      const span = body.resourceSpans[0]?.scopeSpans[0]?.spans[0];
      if (!span) throw new Error('Missing synthetic span');
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(span.flags).toBe(1);
      expect(span.status.code).toBe(kind === 'error' ? 2 : 1);
      expect(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)).toBe(
        kind === 'slow' ? 1_500_000_000n : 10_000_000n,
      );
    },
  );

  it('accepts duplicates but requires every exact downstream marker', () => {
    const text = '-> smoke.id: Str(trace-1)\n-> smoke.id: Str(trace-1)\n-> smoke.id: Str(trace-20)';
    expect(missingMarkers(text, ['trace-1', 'trace-2'])).toEqual(['trace-2']);
    expect(missingMarkers('HTTP 200 trace-1', ['trace-1'])).toEqual(['trace-1']);
    expect(missingMarkers('file_storage.db exists', ['trace-1'])).toEqual(['trace-1']);
  });

  it('requires three explicit non-negative queue series; missing metrics are not zero', () => {
    expect(queueSizes(queues('4'))).toEqual({ traces: 4, metrics: 4, logs: 4 });
    expect(queueSizes(queues('0'))).toEqual({ traces: 0, metrics: 0, logs: 0 });
    expect(() => queueSizes('')).toThrow('Missing queue_size');
    expect(() => queueSizes(queues('0', 'other'))).toThrow('Missing queue_size');
    for (const invalid of ['NaN', '+Inf', '-1'])
      expect(() => queueSizes(queues(invalid))).toThrow();
    expect(() => queueSizes(queues('0').split('\n').slice(0, 2).join('\n'))).toThrow('logs');
  });

  it('does not confuse per-policy rejection or retained traces with final dropped decisions', () => {
    const metrics = [
      'otelcol_processor_tail_sampling_count_traces_sampled_total{sampled="false",policy="errors"} 100',
      'otelcol_processor_tail_sampling_global_count_traces_sampled_total{sampled="true"} 2',
      'otelcol_processor_tail_sampling_global_count_traces_sampled_total{sampled="false"} 5',
    ].join('\n');
    expect(droppedTailTraces(metrics)).toBe(5);
    expect(droppedTailTraces(metrics.replaceAll('_total', ''))).toBe(5);
    expect(droppedTailTraces('')).toBe(0);
  });
});

describe('Docker scope boundaries', () => {
  it('uses absolute native Windows bind paths without shell quoting or interpolation', () => {
    expect(configMount('F:\\work space\\collector.yaml')).toEqual([
      '--mount',
      'type=bind,source=F:\\work space\\collector.yaml,target=/etc/otelcol/collector.yaml,readonly',
    ]);
  });

  it('refuses to start, stop, kill, inspect or read logs from a container it did not create', async () => {
    const scope = new DockerScope('unique-test-run');
    await expect(scope.start('signoz')).rejects.toThrow('unowned');
    await expect(scope.stop('signoz')).rejects.toThrow('unowned');
    await expect(scope.crash('signoz')).rejects.toThrow('unowned');
    await expect(scope.logs('signoz')).rejects.toThrow('unowned');
    await expect(scope.assertRunning('signoz')).rejects.toThrow('unowned');
    await expect(scope.endpoint('signoz', 4318)).rejects.toThrow('unowned');
    expect(scope.network).toBe('unique-test-run-network');
  });
});
