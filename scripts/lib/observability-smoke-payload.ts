export type SmokeSignal = 'traces' | 'metrics' | 'logs' | 'sentry';
export type JsonRecord = Record<string, unknown>;
export type SignalCounts = Record<SmokeSignal, number>;

export interface SmokeRecord {
  readonly resource: JsonRecord;
  readonly scope: string;
  readonly data: JsonRecord;
}

export interface SmokeMetric extends SmokeRecord {
  readonly name: string;
  readonly unit: string;
  readonly kind: 'sum' | 'gauge' | 'histogram' | 'exponentialHistogram';
}

export interface ParsedSmokePayload {
  readonly spans: SmokeRecord[];
  readonly metrics: SmokeMetric[];
  readonly logs: SmokeRecord[];
  readonly events: JsonRecord[];
  canonical: string;
}

export class SmokePayloadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonRecord(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SmokePayloadError(400, 'expected JSON object');
  }
  return value as JsonRecord;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new SmokePayloadError(400, 'expected JSON array');
  return value;
}

function integerValue(value: unknown): boolean {
  return (
    (typeof value === 'string' && /^-?\d+$/.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  );
}

export function validId(value: unknown, length: number): value is string {
  return (
    typeof value === 'string' &&
    value.length === length &&
    /^[a-f\d]+$/i.test(value) &&
    !/^0+$/.test(value)
  );
}

function anyValue(value: unknown, depth = 0): unknown {
  if (depth > 16) throw new SmokePayloadError(400, 'AnyValue nesting limit exceeded');
  const fields = Object.entries(jsonRecord(value));
  const field = fields[0];
  if (fields.length !== 1 || field === undefined)
    throw new SmokePayloadError(400, 'invalid AnyValue');
  const [key, inner] = field;
  if (key === 'arrayValue')
    return array(jsonRecord(inner)['values'] ?? []).map((item) => anyValue(item, depth + 1));
  if (key === 'kvlistValue') return kvlist(inner, depth);
  const valid =
    (key === 'stringValue' && typeof inner === 'string') ||
    (key === 'intValue' && integerValue(inner)) ||
    (key === 'doubleValue' && typeof inner === 'number' && Number.isFinite(inner)) ||
    (key === 'boolValue' && typeof inner === 'boolean') ||
    (key === 'bytesValue' && typeof inner === 'string');
  if (!valid) throw new SmokePayloadError(400, 'unsupported or invalid AnyValue');
  return inner;
}

function kvlist(inner: unknown, depth: number): unknown[] {
  return array(jsonRecord(inner)['values'] ?? []).map((entry) => {
    const item = jsonRecord(entry);
    if (typeof item['key'] !== 'string') throw new SmokePayloadError(400, 'invalid kvlist key');
    return { key: item['key'], value: anyValue(item['value'], depth + 1) };
  });
}

export function otlpAttributes(value: unknown): JsonRecord {
  const result: JsonRecord = {};
  for (const entry of array(value ?? [])) {
    const attribute = jsonRecord(entry);
    if (typeof attribute['key'] !== 'string' || Object.hasOwn(result, attribute['key'])) {
      throw new SmokePayloadError(400, 'invalid or duplicate attribute key');
    }
    Object.defineProperty(result, attribute['key'], {
      value: anyValue(attribute['value']),
      enumerable: true,
    });
  }
  return result;
}

function validateSpan(data: JsonRecord): void {
  if (
    typeof data['name'] !== 'string' ||
    data['name'] === '' ||
    !validId(data['traceId'], 32) ||
    !validId(data['spanId'], 16)
  ) {
    throw new SmokePayloadError(400, 'invalid span record');
  }
  if (!integerValue(data['startTimeUnixNano']) || !integerValue(data['endTimeUnixNano'])) {
    throw new SmokePayloadError(400, 'invalid span timestamps');
  }
  otlpAttributes(data['attributes']);
}

function validateLog(data: JsonRecord): void {
  const severity = data['severityNumber'];
  if (
    typeof severity !== 'number' ||
    !Number.isInteger(severity) ||
    severity < 1 ||
    severity > 24
  ) {
    throw new SmokePayloadError(400, 'invalid log severity');
  }
  anyValue(data['body']);
  otlpAttributes(data['attributes']);
}

function validatePoint(data: JsonRecord, kind: SmokeMetric['kind']): JsonRecord {
  otlpAttributes(data['attributes']);
  if (kind === 'histogram' || kind === 'exponentialHistogram') {
    if (
      !integerValue(data['count']) ||
      typeof data['sum'] !== 'number' ||
      !Number.isFinite(data['sum'])
    ) {
      throw new SmokePayloadError(400, 'invalid histogram point');
    }
  } else if (
    !integerValue(data['asInt']) &&
    !(typeof data['asDouble'] === 'number' && Number.isFinite(data['asDouble']))
  ) {
    throw new SmokePayloadError(400, 'invalid numeric point');
  }
  return data;
}

function parseMetric(record: SmokeRecord): SmokeMetric[] {
  const { data } = record;
  const name = data['name'];
  const unit = data['unit'];
  if (typeof name !== 'string' || name === '' || typeof unit !== 'string') {
    throw new SmokePayloadError(400, 'invalid metric name/unit');
  }
  const kinds = (['sum', 'gauge', 'histogram', 'exponentialHistogram'] as const).filter((kind) =>
    Object.hasOwn(data, kind),
  );
  const kind = kinds[0];
  if (kinds.length !== 1 || kind === undefined)
    throw new SmokePayloadError(400, 'invalid metric kind');
  return array(jsonRecord(data[kind])['dataPoints']).map((point) => ({
    resource: record.resource,
    scope: record.scope,
    name,
    unit,
    kind,
    data: validatePoint(jsonRecord(point), kind),
  }));
}

const SIGNAL_FIELDS = {
  traces: ['resourceSpans', 'scopeSpans', 'spans'],
  metrics: ['resourceMetrics', 'scopeMetrics', 'metrics'],
  logs: ['resourceLogs', 'scopeLogs', 'logRecords'],
} as const;

function appendRecord(signal: SmokeSignal, record: SmokeRecord, parsed: ParsedSmokePayload): void {
  if (signal === 'metrics') parsed.metrics.push(...parseMetric(record));
  else if (signal === 'traces') {
    validateSpan(record.data);
    parsed.spans.push(record);
  } else {
    validateLog(record.data);
    parsed.logs.push(record);
  }
}

function parseResource(
  signal: Exclude<SmokeSignal, 'sentry'>,
  group: JsonRecord,
  parsed: ParsedSmokePayload,
): void {
  const [, scopeKey, recordsKey] = SIGNAL_FIELDS[signal];
  const resource = otlpAttributes(jsonRecord(group['resource'])['attributes']);
  for (const scopeValue of array(group[scopeKey])) {
    const scopeGroup = jsonRecord(scopeValue);
    const scope = jsonRecord(scopeGroup['scope'])['name'];
    if (typeof scope !== 'string' || scope === '')
      throw new SmokePayloadError(400, 'missing scope name');
    for (const item of array(scopeGroup[recordsKey])) {
      appendRecord(signal, { resource, scope, data: jsonRecord(item) }, parsed);
    }
  }
}

function emptyPayload(canonical: string): ParsedSmokePayload {
  return { spans: [], metrics: [], logs: [], events: [], canonical };
}

function parseOtlp(signal: Exclude<SmokeSignal, 'sentry'>, body: string): ParsedSmokePayload {
  const payload = jsonRecord(JSON.parse(body));
  const parsed = emptyPayload(JSON.stringify(payload));
  if (Object.keys(payload).length !== 1) throw new SmokePayloadError(400, 'unexpected OTLP fields');
  for (const resourceValue of array(payload[SIGNAL_FIELDS[signal][0]])) {
    parseResource(signal, jsonRecord(resourceValue), parsed);
  }
  return parsed;
}

interface EnvelopeCursor {
  readonly body: Buffer;
  offset: number;
}

function envelopeLine(cursor: EnvelopeCursor): JsonRecord {
  const end = cursor.body.indexOf(10, cursor.offset);
  if (end < cursor.offset) throw new SmokePayloadError(400, 'missing envelope newline');
  const line = jsonRecord(JSON.parse(cursor.body.subarray(cursor.offset, end).toString('utf8')));
  cursor.offset = end + 1;
  return line;
}

function envelopeItem(cursor: EnvelopeCursor, header: JsonRecord): JsonRecord {
  const length = header['length'];
  if (
    length !== undefined &&
    (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1)
  ) {
    throw new SmokePayloadError(400, 'invalid envelope item length');
  }
  const newline = cursor.body.indexOf(10, cursor.offset);
  const end =
    typeof length === 'number'
      ? cursor.offset + length
      : newline === -1
        ? cursor.body.length
        : newline;
  if (end > cursor.body.length) throw new SmokePayloadError(400, 'truncated envelope item');
  const event = jsonRecord(JSON.parse(cursor.body.subarray(cursor.offset, end).toString('utf8')));
  cursor.offset = end;
  if (cursor.offset < cursor.body.length) {
    if (cursor.body[cursor.offset] !== 10)
      throw new SmokePayloadError(400, 'invalid envelope separator');
    cursor.offset += 1;
  }
  return event;
}

function parseEnvelope(body: Buffer): ParsedSmokePayload {
  const cursor = { body, offset: 0 };
  const envelope = envelopeLine(cursor);
  const parsed = emptyPayload(JSON.stringify(envelope));
  let items = 0;
  while (cursor.offset < body.length) {
    const header = envelopeLine(cursor);
    const type = header['type'];
    if (!['event', 'session', 'sessions', 'client_report'].includes(String(type))) {
      throw new SmokePayloadError(415, 'unsupported envelope item (no minidumps)');
    }
    const event = envelopeItem(cursor, header);
    parsed.canonical += JSON.stringify(event);
    if (type === 'event') {
      if (
        !validId(event['event_id'], 32) ||
        (envelope['event_id'] !== undefined && envelope['event_id'] !== event['event_id'])
      ) {
        throw new SmokePayloadError(400, 'invalid envelope event ID');
      }
      parsed.events.push(event);
    }
    items += 1;
  }
  if (items === 0) throw new SmokePayloadError(400, 'empty envelope');
  return parsed;
}

export function parseSmokePayload(signal: SmokeSignal, body: Buffer): ParsedSmokePayload {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  return signal === 'sentry' ? parseEnvelope(body) : parseOtlp(signal, text);
}
