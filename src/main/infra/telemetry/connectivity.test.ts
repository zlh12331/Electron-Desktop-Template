import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probeOtlpTargets: vi.fn(
    async (): Promise<
      Array<{
        signal: 'traces' | 'metrics' | 'logs';
        url: string;
        ok: boolean;
        statusCode: number | null;
        message: string;
      }>
    > => [],
  ),
}));

vi.mock('@code-agent/shared/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@code-agent/shared/observability')>();
  return { ...actual, probeOtlpTargets: mocks.probeOtlpTargets };
});

import type { OtelResolvedConfig } from '@code-agent/shared/observability';

import { probeOtlpEndpoints } from './connectivity';

function config(overrides: Partial<OtelResolvedConfig> = {}): OtelResolvedConfig {
  return {
    level: 'full',
    enabled: true,
    consoleTracing: false,
    traceEndpoint: null,
    metricEndpoint: null,
    logEndpoint: null,
    traceSampleRatio: 1,
    logMinLevel: 'info',
    logSampleRatio: 1,
    logMaxPerMinute: 0,
    metricExportIntervalMs: 60_000,
    headers: {},
    serviceName: 'app-dev',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.probeOtlpTargets.mockResolvedValue([]);
});

describe('probeOtlpEndpoints', () => {
  it('只把已配置的端点交给 shared 探测，并把 reachable 转成中文', async () => {
    mocks.probeOtlpTargets.mockResolvedValue([
      {
        signal: 'traces',
        url: 'http://x/v1/traces',
        ok: true,
        statusCode: 200,
        message: 'reachable',
      },
    ]);
    const results = await probeOtlpEndpoints(
      config({
        traceEndpoint: 'http://x/v1/traces',
        metricEndpoint: null,
        logEndpoint: null,
      }),
    );
    expect(mocks.probeOtlpTargets).toHaveBeenCalledWith(
      [{ signal: 'traces', url: 'http://x/v1/traces' }],
      {},
    );
    expect(results[0]).toMatchObject({ signal: 'traces', ok: true, message: '可达' });
  });

  it('没有端点：不发起探测', async () => {
    const results = await probeOtlpEndpoints(config());
    expect(results).toEqual([]);
    expect(mocks.probeOtlpTargets).toHaveBeenCalledWith([], {});
  });
});
