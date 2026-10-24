import { randomBytes } from 'node:crypto';

import { dump, load } from 'js-yaml';

/** Fixed upstream release used by both relay and synthetic sink. */
export const COLLECTOR_IMAGE: string = 'otel/opentelemetry-collector-contrib:0.163.2';
/** Volume initialization only; never mounts a host directory or an existing external volume. */
export const STORAGE_INIT_IMAGE: string = 'busybox:1.38.0';
/** The three independent persistent exporter queues. */
export const SIGNALS: readonly ['traces', 'metrics', 'logs'] = ['traces', 'metrics', 'logs'];
/** Supported synthetic OTLP signals. */
export type Signal = (typeof SIGNALS)[number];
/** Distinct policy candidates; all are sent with the sampled flag. */
export type SpanKind = 'normal' | 'error' | 'slow';
/** Payload and exact debug-exporter evidence expected downstream. */
export interface SyntheticBatch {
  signal: Signal;
  markers: string[];
  body: unknown;
}

function attribute(key: string, value: string): { key: string; value: { stringValue: string } } {
  return { key, value: { stringValue: value } };
}

/** Produces only synthetic data; never reads an application, environment file, or telemetry SDK. */
export function makeBatch(
  signal: Signal,
  prefix: string,
  count: number,
  spanKind: SpanKind = 'normal',
): SyntheticBatch {
  const markers = Array.from({ length: count }, (_, index) => `${prefix}-${signal}-${index}-end`);
  const now = BigInt(Date.now()) * 1_000_000n;
  const resource = { attributes: [attribute('service.name', 'collector-smoke-synthetic')] };
  const scope = { name: 'collector-smoke' };
  const records = markers.map((marker) => {
    const attributes = [attribute('smoke.id', marker)];
    if (signal === 'traces') {
      return {
        traceId: randomBytes(16).toString('hex'),
        spanId: randomBytes(8).toString('hex'),
        name: `synthetic-${spanKind}`,
        kind: 1,
        flags: 1,
        startTimeUnixNano: (now - (spanKind === 'slow' ? 1_500_000_000n : 10_000_000n)).toString(),
        endTimeUnixNano: now.toString(),
        status: { code: spanKind === 'error' ? 2 : 1 },
        attributes,
      };
    }
    if (signal === 'logs') {
      return {
        timeUnixNano: now.toString(),
        severityNumber: 9,
        body: { stringValue: 'collector smoke synthetic log' },
        attributes,
      };
    }
    return { timeUnixNano: now.toString(), asInt: '1', attributes };
  });
  if (signal === 'traces') {
    return {
      signal,
      markers,
      body: { resourceSpans: [{ resource, scopeSpans: [{ scope, spans: records }] }] },
    };
  }
  if (signal === 'logs') {
    return {
      signal,
      markers,
      body: { resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: records }] }] },
    };
  }
  return {
    signal,
    markers,
    body: {
      resourceMetrics: [
        {
          resource,
          scopeMetrics: [
            {
              scope,
              metrics: [{ name: 'collector.smoke.synthetic', gauge: { dataPoints: records } }],
            },
          ],
        },
      ],
    },
  };
}

/** Do not confuse successful HTTP ingestion or a partial matching ID with downstream delivery. */
export function missingMarkers(output: string, markers: readonly string[]): string[] {
  const received = new Set(
    [...output.matchAll(/smoke\.id: Str\(([^)\r\n]+)\)/g)].map((match) => match[1]),
  );
  return markers.filter((marker) => !received.has(marker));
}

interface MetricSample {
  labels: string;
  value: number;
}

function metricSamples(text: string, name: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const line of text.split('\n')) {
    const match = /^(\w+)(?:\{(.*)\})?\s+([^\s]+)(?:\s+.*)?$/.exec(line);
    if (match?.[1] !== name) continue;
    const value = Number(match[3]);
    if (Number.isFinite(value) && value >= 0) samples.push({ labels: match[2] ?? '', value });
  }
  return samples;
}

/** Missing series is an error, never evidence of an empty queue. */
export function queueSizes(text: string): Record<Signal, number> {
  const samples = metricSamples(text, 'otelcol_exporter_queue_size').filter((sample) =>
    sample.labels.includes('exporter="otlp_http/upstream"'),
  );
  const sizes = { traces: 0, metrics: 0, logs: 0 };
  for (const signal of SIGNALS) {
    const matches = samples.filter((sample) => sample.labels.includes(`data_type="${signal}"`));
    if (matches.length === 0) throw new Error(`Missing queue_size series for ${signal}`);
    sizes[signal] = matches.reduce((sum, sample) => sum + sample.value, 0);
  }
  return sizes;
}

/** Count final decisions, NOT per-policy rejections of traces that another policy may retain. */
export function droppedTailTraces(text: string): number {
  const name = 'otelcol_processor_tail_sampling_global_count_traces_sampled';
  // The internal Prometheus reader may omit counter suffixes, unlike an external Prometheus exporter.
  const samples = [...metricSamples(text, name), ...metricSamples(text, `${name}_total`)];
  return samples
    .filter((sample) => sample.labels.includes('sampled="false"'))
    .reduce((sum, sample) => sum + sample.value, 0);
}

/** Detailed debug output is safe here because this sink has no input except synthetic fixtures. */
export const SINK_CONFIG: string = `receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: detailed
    sampling_initial: 1000000
    sampling_thereafter: 1
service:
  telemetry:
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      exporters: [debug]
    logs:
      receivers: [otlp]
      exporters: [debug]
`;

/** Keeps the real 30s decision wait and all production policies, changing ONLY the baseline to 0%. */
export function zeroPercentTailFixture(overlay: string): string {
  const needle = 'sampling_percentage: 10';
  if (overlay.split(needle).length !== 2) throw new Error('Expected one 10% tail baseline');
  // Parsing the result also rejects invalid fixture YAML before launching Docker.
  return dump(load(overlay.replace(needle, 'sampling_percentage: 0')));
}
