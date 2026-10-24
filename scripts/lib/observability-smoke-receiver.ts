import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import {
  type JsonRecord,
  SmokePayloadError as PayloadError,
  parseSmokePayload,
  type SignalCounts,
  type SmokeMetric,
  type SmokeRecord,
  type SmokeSignal,
} from './observability-smoke-payload';

export type {
  JsonRecord,
  SignalCounts,
  SmokeMetric,
  SmokeRecord,
  SmokeSignal,
} from './observability-smoke-payload';
export { jsonRecord, otlpAttributes, validId } from './observability-smoke-payload';

export interface SmokeSnapshot {
  readonly totalRequests: number;
  readonly requests: Readonly<SignalCounts>;
  readonly records: Readonly<SignalCounts>;
  readonly rejected: number;
  readonly issues: readonly string[];
  readonly leaked: boolean;
  readonly spans: readonly SmokeRecord[];
  readonly metrics: readonly SmokeMetric[];
  readonly logs: readonly SmokeRecord[];
  readonly events: readonly JsonRecord[];
}

export interface SmokeReceiverOptions {
  readonly maxBodyBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxRecords?: number;
  readonly maxRequests?: number;
  readonly forbiddenValues?: readonly string[];
}

export interface SmokeReceiver {
  readonly endpoint: string;
  snapshot(): SmokeSnapshot;
  setAvailable(available: boolean): void;
  close(): Promise<void>;
}

interface ReceiverLimits {
  readonly body: number;
  readonly total: number;
  readonly records: number;
  readonly requests: number;
}

function route(request: IncomingMessage): SmokeSignal {
  if (request.method !== 'POST') throw new PayloadError(405, 'POST required');
  switch (request.url) {
    case '/v1/traces':
      return 'traces';
    case '/v1/metrics':
      return 'metrics';
    case '/v1/logs':
      return 'logs';
    default:
      if (/^\/api\/1\/envelope\/(?:\?[^#]*)?$/.test(request.url ?? '')) return 'sentry';
      throw new PayloadError(404, 'unknown path');
  }
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = (error: Error): void => {
      if (done) return;
      done = true;
      chunks = [];
      reject(error);
    };
    request.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) fail(new PayloadError(413, 'request body limit exceeded'));
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    request.on('aborted', () => fail(new PayloadError(400, 'request aborted')));
    request.on('error', () => fail(new PayloadError(400, 'request stream failed')));
    request.setTimeout(5_000, () => {
      fail(new PayloadError(408, 'request body timeout'));
      request.destroy();
    });
    const declared = Number(request.headers['content-length']);
    if (declared > limit) fail(new PayloadError(413, 'request body limit exceeded'));
  });
}

function counts(): SignalCounts {
  return { traces: 0, metrics: 0, logs: 0, sentry: 0 };
}

interface DecodedBody {
  readonly body: Buffer;
  readonly bytes: number;
}

async function decodeRequest(
  request: IncomingMessage,
  signal: SmokeSignal,
  limit: number,
): Promise<DecodedBody> {
  const expected = signal === 'sentry' ? 'application/x-sentry-envelope' : 'application/json';
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== expected) {
    throw new PayloadError(415, 'unsupported content type');
  }
  const encoding = request.headers['content-encoding'] ?? 'identity';
  if (encoding !== 'identity' && encoding !== 'gzip')
    throw new PayloadError(415, 'unsupported content encoding');
  const wire = await readBody(request, limit);
  try {
    const body = encoding === 'gzip' ? gunzipSync(wire, { maxOutputLength: limit }) : wire;
    return { body, bytes: Math.max(wire.length, body.length) };
  } catch {
    throw new PayloadError(413, 'invalid or oversized compressed body');
  }
}

class ReceiverStore {
  readonly state = {
    totalRequests: 0,
    requests: counts(),
    records: counts(),
    rejected: 0,
    issues: [] as string[],
    leaked: false,
    spans: [] as SmokeRecord[],
    metrics: [] as SmokeMetric[],
    logs: [] as SmokeRecord[],
    events: [] as JsonRecord[],
  };
  private totalBytes = 0;
  private totalRecords = 0;
  private active = 0;
  available = true;

  constructor(
    private readonly limits: ReceiverLimits,
    private readonly forbidden: readonly string[],
  ) {}

  private leaks(text: string): boolean {
    return this.forbidden.some((value) => value !== '' && text.includes(value));
  }

  private accept(signal: SmokeSignal, decoded: DecodedBody): void {
    this.totalBytes += decoded.bytes;
    if (this.totalBytes > this.limits.total)
      throw new PayloadError(413, 'total body limit exceeded');
    this.state.leaked ||= this.leaks(decoded.body.toString('utf8'));
    const parsed = parseSmokePayload(signal, decoded.body);
    this.state.leaked ||= this.leaks(parsed.canonical);
    const count =
      parsed.spans.length + parsed.metrics.length + parsed.logs.length + parsed.events.length;
    if (this.totalRecords + count > this.limits.records)
      throw new PayloadError(413, 'total record limit exceeded');
    this.totalRecords += count;
    this.state.records[signal] += count;
    this.state.spans.push(...parsed.spans);
    this.state.metrics.push(...parsed.metrics);
    this.state.logs.push(...parsed.logs);
    this.state.events.push(...parsed.events);
  }

  reject(error: unknown): void {
    this.state.rejected += 1;
    if (this.state.issues.length < 20) {
      this.state.issues.push(
        error instanceof PayloadError ? error.message : 'malformed payload or receiver error',
      );
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.state.totalRequests += 1;
    this.active += 1;
    try {
      const signal = route(request);
      this.state.requests[signal] += 1;
      if (!this.available) throw new PayloadError(503, 'local receiver temporarily unavailable');
      if (this.state.totalRequests > this.limits.requests || this.active > 16)
        throw new PayloadError(429, 'request count limit exceeded');
      this.accept(signal, await decodeRequest(request, signal, this.limits.body));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    } catch (error) {
      this.reject(error);
      response.writeHead(error instanceof PayloadError ? error.status : 400);
      response.end();
      request.resume();
    } finally {
      this.active -= 1;
    }
  }

  snapshot(): SmokeSnapshot {
    return {
      ...this.state,
      requests: { ...this.state.requests },
      records: { ...this.state.records },
      spans: this.state.spans.slice(),
      metrics: this.state.metrics.slice(),
      logs: this.state.logs.slice(),
      events: this.state.events.slice(),
      issues: this.state.issues.slice(),
    };
  }
}

export async function createSmokeReceiver(
  options: SmokeReceiverOptions = {},
): Promise<SmokeReceiver> {
  const limits = {
    body: options.maxBodyBytes ?? 2 * 1024 * 1024,
    total: options.maxTotalBytes ?? 16 * 1024 * 1024,
    records: options.maxRecords ?? 10_000,
    requests: options.maxRequests ?? 256,
  };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('positive integer receiver limits required');
  }
  const store = new ReceiverStore(limits, options.forbiddenValues ?? []);
  const server = createServer((request, response) => {
    void store.handle(request, response).catch((error: unknown) => {
      store.reject(error);
      response.destroy();
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.on('error', (error) => store.reject(error));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('missing local receiver port');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    snapshot: () => store.snapshot(),
    setAvailable: (value) => {
      store.available = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
