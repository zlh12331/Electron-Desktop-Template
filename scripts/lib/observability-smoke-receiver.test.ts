import { request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createSmokeReceiver, type SmokeReceiver } from './observability-smoke-receiver';

async function post(receiver: SmokeReceiver, body: unknown, path = '/v1/traces'): Promise<number> {
  const response = await fetch(`${receiver.endpoint}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await response.text();
  return response.status;
}

const tracePayload = {
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'observability-smoke' } }],
      },
      scopeSpans: [
        {
          scope: { name: 'smoke-fixture' },
          spans: [
            {
              name: 'app.startup',
              traceId: '1234567890abcdef1234567890abcdef',
              spanId: '1234567890abcdef',
              startTimeUnixNano: '100',
              endTimeUnixNano: '200',
            },
          ],
        },
      ],
    },
  ],
};

describe('local JSON receiver', () => {
  it('bounds streaming bodies without a Content-Length header', async () => {
    const receiver = await createSmokeReceiver({ maxBodyBytes: 64 });
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(
          `${receiver.endpoint}/v1/traces`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
        req.write(' '.repeat(32));
        req.end(' '.repeat(64));
      });
      expect(status).toBe(413);
      expect(receiver.snapshot().spans).toHaveLength(0);
    } finally {
      await receiver.close();
    }
  });

  it('collects metric data points and log records from their actual scope fields', async () => {
    const receiver = await createSmokeReceiver();
    const resource = {
      attributes: [{ key: 'service.name', value: { stringValue: 'observability-smoke' } }],
    };
    try {
      expect(
        await post(
          receiver,
          {
            resourceMetrics: [
              {
                resource,
                scopeMetrics: [
                  {
                    scope: { name: 'fixture' },
                    metrics: [
                      {
                        name: 'web_vitals.lcp',
                        unit: 'ms',
                        histogram: { dataPoints: [{ count: '1', sum: 2500 }] },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          '/v1/metrics',
        ),
      ).toBe(200);
      expect(
        await post(
          receiver,
          {
            resourceLogs: [
              {
                resource,
                scopeLogs: [
                  {
                    scope: { name: 'fixture' },
                    logRecords: [
                      {
                        severityNumber: 17,
                        body: { stringValue: 'synthetic error' },
                        attributes: [{ key: 'log.attempt', value: { intValue: 1 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          '/v1/logs',
        ),
      ).toBe(200);
      const snapshot = receiver.snapshot();
      expect(snapshot.records.metrics).toBe(1);
      expect(snapshot.records.logs).toBe(1);
      expect(snapshot.metrics[0]).toMatchObject({
        name: 'web_vitals.lcp',
        unit: 'ms',
        kind: 'histogram',
        data: { count: '1', sum: 2500 },
      });
      expect(snapshot.logs[0]?.data['severityNumber']).toBe(17);
    } finally {
      await receiver.close();
    }
  });

  it('does not count session-only Sentry envelopes as error events', async () => {
    const receiver = await createSmokeReceiver();
    try {
      const response = await fetch(`${receiver.endpoint}/api/1/envelope/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: '{}\n{"type":"session"}\n{"status":"ok"}',
      });
      await response.text();
      expect(response.status).toBe(200);
      expect(receiver.snapshot().requests.sentry).toBe(1);
      expect(receiver.snapshot().records.sentry).toBe(0);
    } finally {
      await receiver.close();
    }
  });

  it('recovers from a local receiver 503 without counting the rejected record', async () => {
    const receiver = await createSmokeReceiver();
    try {
      receiver.setAvailable(false);
      expect(await post(receiver, tracePayload)).toBe(503);
      expect(receiver.snapshot().records.traces).toBe(0);
      receiver.setAvailable(true);
      expect(await post(receiver, tracePayload)).toBe(200);
      expect(receiver.snapshot().requests.traces).toBe(2);
      expect(receiver.snapshot().records.traces).toBe(1);
    } finally {
      await receiver.close();
    }
  });

  it('rejects forged AnyValue keys instead of treating their values as attributes', async () => {
    const receiver = await createSmokeReceiver();
    try {
      const body = JSON.stringify(tracePayload).replace('"stringValue"', '"fakeStringValue"');
      const response = await fetch(`${receiver.endpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      await response.text();
      expect(response.status).toBe(400);
      expect(receiver.snapshot().records.traces).toBe(0);
    } finally {
      await receiver.close();
    }
  });

  it.each([
    {
      resourceMetrics: [
        {
          resource: {},
          scopeMetrics: [
            {
              scope: { name: 'fixture' },
              metrics: [{ name: 'app.db.recovery', unit: '1', sum: { dataPoints: [{}] } }],
            },
          ],
        },
      ],
    },
    {
      resourceLogs: [
        {
          resource: {},
          scopeLogs: [
            {
              scope: { name: 'fixture' },
              logRecords: [
                { severityNumber: 17, body: { ['SmokeSyntheticError']: 'fakeStringValue' } },
              ],
            },
          ],
        },
      ],
    },
  ])('rejects metric/log records that only imitate field names', async (body) => {
    const receiver = await createSmokeReceiver();
    try {
      const path = 'resourceMetrics' in body ? '/v1/metrics' : '/v1/logs';
      expect(await post(receiver, body, path)).toBe(400);
      expect(receiver.snapshot().records.metrics + receiver.snapshot().records.logs).toBe(0);
    } finally {
      await receiver.close();
    }
  });

  it('counts structured records separately from empty connection probes', async () => {
    const receiver = await createSmokeReceiver();
    try {
      for (const body of [{ resourceSpans: [] }, tracePayload]) {
        const response = await fetch(`${receiver.endpoint}/v1/traces`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
        await response.text();
      }
      const snapshot = receiver.snapshot();
      expect(snapshot.requests.traces).toBe(2);
      expect(snapshot.records.traces).toBe(1);
      expect(snapshot.spans[0]?.data['name']).toBe('app.startup');
      expect(snapshot.spans[0]?.resource['service.name']).toBe('observability-smoke');
    } finally {
      await receiver.close();
    }
  });

  it.each([
    { 'resourceSpans app.startup': [] },
    { resourceSpans: 'app.startup db.init window.create' },
    { resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'app.startup' }] }] }] },
    { resourceSpans: [], nested: tracePayload },
    {
      resourceSpans: [
        {
          resource: {},
          scopeSpans: [{ scope: { name: 'fixture' }, spans: [{ description: 'app.startup' }] }],
        },
      ],
    },
  ])('does not count forged field names or malformed records: %j', async (body) => {
    const receiver = await createSmokeReceiver();
    try {
      expect(await post(receiver, body)).toBe(400);
      expect(receiver.snapshot().records.traces).toBe(0);
      expect(receiver.snapshot().rejected).toBe(1);
    } finally {
      await receiver.close();
    }
  });

  it.each([
    ['/unknown', 'application/json', 'POST', 404],
    ['/v1/traces?extra=true', 'application/json', 'POST', 404],
    ['/v1/traces', 'application/x-protobuf', 'POST', 415],
    ['/v1/traces', 'text/plain', 'POST', 415],
    ['/v1/traces', 'application/json', 'GET', 405],
  ] as const)('rejects %s with %s and %s', async (path, contentType, method, expected) => {
    const receiver = await createSmokeReceiver();
    try {
      const response = await fetch(`${receiver.endpoint}${path}`, {
        method,
        headers: { 'content-type': contentType },
      });
      await response.text();
      expect(response.status).toBe(expected);
      expect(receiver.snapshot().totalRequests).toBe(1);
      expect(receiver.snapshot().records.traces).toBe(0);
    } finally {
      await receiver.close();
    }
  });

  it.each([{ maxBodyBytes: 32 }, { maxTotalBytes: 32 }])(
    'does not collect oversized bodies: %j',
    async (limits) => {
      const receiver = await createSmokeReceiver(limits);
      try {
        expect(await post(receiver, tracePayload)).toBe(413);
        expect(receiver.snapshot().spans).toHaveLength(0);
      } finally {
        await receiver.close();
      }
    },
  );

  it('bounds total records atomically and preserves earlier records', async () => {
    const receiver = await createSmokeReceiver({ maxRecords: 1 });
    try {
      expect(await post(receiver, tracePayload)).toBe(200);
      expect(await post(receiver, tracePayload)).toBe(413);
      expect(receiver.snapshot().records.traces).toBe(1);
      expect(receiver.snapshot().spans).toHaveLength(1);
    } finally {
      await receiver.close();
    }
  });

  it('bounds request totals including empty probes', async () => {
    const receiver = await createSmokeReceiver({ maxRequests: 1 });
    try {
      expect(await post(receiver, { resourceSpans: [] })).toBe(200);
      expect(await post(receiver, { resourceSpans: [] })).toBe(429);
      expect(receiver.snapshot().records.traces).toBe(0);
    } finally {
      await receiver.close();
    }
  });

  it('bounds gzip expansion as well as wire bytes', async () => {
    const receiver = await createSmokeReceiver({ maxBodyBytes: 128 });
    try {
      const response = await fetch(`${receiver.endpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        body: gzipSync(' '.repeat(10_000)),
      });
      await response.text();
      expect(response.status).toBe(413);
      expect(receiver.snapshot().spans).toHaveLength(0);
    } finally {
      await receiver.close();
    }
  });

  it('parses local synthetic Sentry envelopes with byte lengths and gzip', async () => {
    const receiver = await createSmokeReceiver();
    try {
      const event = JSON.stringify({
        ['event_id']: '1234567890abcdef1234567890abcdef',
        message: '本地合成',
      });
      const envelope = `{}\n${JSON.stringify({ type: 'event', length: Buffer.byteLength(event) })}\n${event}`;
      const response = await fetch(`${receiver.endpoint}/api/1/envelope/?sentry_key=smoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope', 'content-encoding': 'gzip' },
        body: gzipSync(envelope),
      });
      await response.text();
      expect(response.status).toBe(200);
      expect(receiver.snapshot().records.sentry).toBe(1);
      expect(receiver.snapshot().events[0]?.['message']).toBe('本地合成');
    } finally {
      await receiver.close();
    }
  });

  it.each([
    '{}\n{"type":"attachment"}\n{}',
    '{}\n{"type":"event","length":900}\n{}',
    '{}\n{"type":"event"}\n{"event_id":"wrong"}',
    '{"event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n{"type":"event"}\n{"event_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',
  ])('does not count malformed or native Sentry envelopes', async (body) => {
    const receiver = await createSmokeReceiver();
    try {
      const response = await fetch(`${receiver.endpoint}/api/1/envelope/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body,
      });
      await response.text();
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(receiver.snapshot().records.sentry).toBe(0);
    } finally {
      await receiver.close();
    }
  });

  it('detects sensitive values after JSON escape decoding', async () => {
    const receiver = await createSmokeReceiver({ forbiddenValues: ['synthetic-sensitive-value'] });
    try {
      const body = JSON.stringify(tracePayload)
        .replace('app.startup', 'synthetic-sensitive-value')
        .replace('sensitive', '\\u0073ensitive');
      const response = await fetch(`${receiver.endpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      await response.text();
      expect(response.status).toBe(200);
      expect(receiver.snapshot().leaked).toBe(true);
    } finally {
      await receiver.close();
    }
  });
});
