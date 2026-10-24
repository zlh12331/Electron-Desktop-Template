import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  OBSERVABILITY_METRIC_DEFINITIONS,
  OBSERVABILITY_METRIC_NAMES,
  OBSERVABILITY_METRICS,
  WEB_VITAL_METRICS,
} from '@code-agent/shared/observability';
import { describe, expect, it } from 'vitest';

import { findMissingSloDocs, validateSloDocument } from './observability-slo';
import type {
  ObservabilityFilters,
  ObservabilityIncreaseQuery,
  ObservabilitySlo,
  ObservabilitySloDocument,
  ObservabilitySloQuery,
} from './observability-slo-types';

const doc = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../observability/slo.json'), 'utf8'),
) as ObservabilitySloDocument;

function slo(id: string): ObservabilitySlo {
  const entry = doc.slos.find((item) => item.id === id);
  if (entry === undefined) throw new Error(`Missing fixture: ${id}`);
  return entry;
}

const ipc = slo('ipc-error-rate');
const latency = slo('ipc-p95-latency');
const countAlert = doc.alerts[0];
if (countAlert === undefined) throw new Error('Missing count alert fixture');

function withSlo(patch: Record<string, unknown>): unknown {
  return { ...doc, slos: [{ ...ipc, ...patch }], alerts: [] };
}

function expectRejected(value: unknown): void {
  expect(validateSloDocument(value).length).toBeGreaterThan(0);
}

describe('metric definitions', () => {
  it('覆盖所有公开名字且无额外指标，保留字符串导出', () => {
    expect([...OBSERVABILITY_METRIC_NAMES].sort()).toEqual(
      [...Object.values(OBSERVABILITY_METRICS), ...Object.values(WEB_VITAL_METRICS)].sort(),
    );
    expect(OBSERVABILITY_METRICS.updateChecks).toBe('app.update.checks');
    expect(OBSERVABILITY_METRIC_NAMES).toHaveLength(21);
    expect(OBSERVABILITY_METRIC_DEFINITIONS['app.update.checks']).toMatchObject({
      type: 'counter',
      unit: '1',
      attributes: { outcome: ['success', 'error'] },
    });
  });

  it('动态标签与有限值域均登记，CLS 保持无量纲', () => {
    expect(OBSERVABILITY_METRIC_DEFINITIONS['ipc.server.requests'].attributes).toEqual({
      channel: [],
      outcome: ['success', 'error'],
      failureClass: ['none', 'validation', 'business', 'system'],
    });
    expect(
      OBSERVABILITY_METRIC_DEFINITIONS['electron.process.cpu'].attributes['process.name'],
    ).toEqual([]);
    expect(OBSERVABILITY_METRIC_DEFINITIONS['app.renderer.crashes'].attributes['reason']).toContain(
      'unknown',
    );
    expect(OBSERVABILITY_METRIC_DEFINITIONS['web_vitals.cls'].unit).toBe('1');
  });
});

describe('validateSloDocument structure', () => {
  it('真实 v2 契约通过，保留原 11 个目标并增加 2 个独立告警', () => {
    expect(validateSloDocument(doc)).toEqual([]);
    expect(doc.slos).toHaveLength(11);
    expect(doc.alerts).toHaveLength(2);
    expect(doc.slos.map((entry) => entry.id)).toEqual([
      'crash-free-sessions',
      'ipc-error-rate',
      'ipc-p95-latency',
      'startup-p95',
      'update-check-failure',
      'update-download-p95',
      'db-backup-success',
      'event-loop-p99',
      'web-vitals-lcp',
      'web-vitals-inp',
      'web-vitals-cls',
    ]);
  });

  it.each([
    null,
    undefined,
    [],
    {},
    { ...doc, version: 1 },
    { ...doc, slos: [] },
    { ...doc, slos: [null] },
    { ...doc, alerts: [null] },
    { ...doc, alerts: null },
    { ...doc, updatedAt: '2026-99-99' },
    { ...doc, arbitrary: true },
  ])('拒绝错误根或空条目 #%#', (value) => expectRejected(value));

  it.each(['', 'Upper-case', '-leading', 'trailing-', 'double--dash'])('拒绝非法 id：%s', (id) => {
    expectRejected(withSlo({ id }));
  });

  it('拒绝 SLO 与独立告警跨数组重复 id', () => {
    expect(validateSloDocument({ ...doc, alerts: [{ ...countAlert, id: ipc.id }] })).toContain(
      `id 重复：${ipc.id}`,
    );
    expectRejected({ ...doc, slos: [ipc, ipc] });
  });

  it.each([
    '0m',
    '-1h',
    '1.5h',
    '01h',
    '1year',
    '1s',
    '1H',
    ' 1h',
    'Infinityh',
    '999999999999999999999d',
  ])('拒绝非法窗口：%s', (window) => {
    expectRejected(withSlo({ query: { ...ipc.query, window } }));
    expectRejected(withSlo({ alert: { ...ipc.alert, for: window } }));
  });

  it.each([NaN, Infinity, -Infinity, null, -1, '0.01'])('拒绝非有限或非法阈值：%s', (threshold) => {
    expectRejected(withSlo({ target: { ...ipc.target, threshold } }));
    expectRejected(withSlo({ alert: { ...ipc.alert, threshold } }));
    expectRejected({
      ...doc,
      alerts: [{ ...countAlert, alert: { ...countAlert.alert, threshold } }],
    });
  });

  it.each([NaN, Infinity, -Infinity, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    '拒绝非法 minSamples：%s',
    (minSamples) => {
      expectRejected(withSlo({ query: { ...ipc.query, minSamples } }));
    },
  );

  it.each([NaN, Infinity, -Infinity, null, 0, -1, 101])('拒绝非法百分位：%s', (percentile) => {
    expectRejected(withSlo({ ...latency, query: { ...latency.query, percentile } }));
  });

  it('拒绝自由条件、旧结构和未声明字段，不静默丢弃', () => {
    expectRejected(withSlo({ alert: { ...ipc.alert, condition: '> 0.05' } }));
    expectRejected(withSlo({ target: '> 0.05' }));
    expectRejected(withSlo({ alert: null }));
    expectRejected(withSlo({ query: null }));
    expectRejected(withSlo({ source: 'otel', metric: 'ipc.server.requests' }));
    expectRejected(withSlo({ query: { ...ipc.query, expression: 'sum(errors)' } }));
    expectRejected(withSlo({ alert: { ...ipc.alert, severity: 'fatal' } }));
  });
});

describe('validateSloDocument query semantics', () => {
  it('拒绝未知指标、非法聚合、仪表类型不符', () => {
    for (const metric of ['unknown.metric', 'toString', 'app.startup.duration']) {
      expectRejected(withSlo({ query: { ...ipc.query, metric } }));
    }
    expectRejected(withSlo({ query: { ...ipc.query, aggregation: 'error-rate' } }));
    expectRejected(
      withSlo({ ...latency, query: { ...latency.query, metric: 'ipc.server.requests' } }),
    );
    expectRejected(
      withSlo({ ...latency, query: { ...latency.query, metric: 'process.memory.usage' } }),
    );
    expectRejected({
      ...doc,
      alerts: [{ ...countAlert, query: { ...countAlert.query, metric: 'app.db.backup.duration' } }],
    });
  });

  it.each([
    { phase: ['ready'] },
    { outcome: ['accepted'] },
    { outcome: [] },
    { outcome: [null] },
    { outcome: ['success', 'success'] },
    { outcome: 'success' },
    { outcome: ['error '] },
    { channel: [''] },
    { toString: ['value'] },
    { constructor: ['value'] },
    JSON.parse('{"__proto__":["value"]}'),
    null,
  ] as unknown[])('拒绝非法 filter 键、值或结构：%j', (filters) => {
    expectRejected(withSlo({ query: { ...ipc.query, filters } }));
    expectRejected(withSlo({ query: { ...ipc.query, numeratorFilters: filters } }));
  });

  it('动态 channel 接受任意非空字符串，但分子必须完整声明分母约束', () => {
    expect(
      validateSloDocument(
        withSlo({
          query: {
            ...ipc.query,
            filters: { channel: ['settings:getAll'], failureClass: ['none', 'system'] },
            numeratorFilters: {
              channel: ['settings:getAll'],
              failureClass: ['system'],
              outcome: ['error'],
            },
          },
        }),
      ),
    ).toEqual([]);
    expectRejected(withSlo({ query: { ...ipc.query, numeratorFilters: { outcome: ['error'] } } }));
    expectRejected(
      withSlo({ query: { ...ipc.query, numeratorFilters: { failureClass: ['business'] } } }),
    );
    expectRejected(
      withSlo({
        query: { ...ipc.query, numeratorFilters: { failureClass: ['system', 'validation'] } },
      }),
    );
    expectRejected(withSlo({ query: { ...ipc.query, numeratorFilters: {} } }));
  });

  it('单位按仪表而非展示换算，比例为 0..1', () => {
    for (const unit of ['seconds', 'ratio', 'score', 'By']) {
      expectRejected(withSlo({ ...latency, target: { ...latency.target, unit } }));
    }
    expectRejected(withSlo({ target: { ...ipc.target, unit: 'ms' } }));
    expectRejected(withSlo({ target: { ...ipc.target, threshold: 1.01 } }));
    expectRejected(withSlo({ alert: { ...ipc.alert, threshold: 1.01 } }));
    expectRejected({ ...doc, alerts: [{ ...countAlert, unit: 'ms' }] });
  });

  it('告警须指向违约方向，触发区间不得覆盖达标值', () => {
    expectRejected(withSlo({ alert: { ...ipc.alert, operator: 'lt' } }));
    expectRejected(withSlo({ alert: { ...ipc.alert, threshold: 0.001 } }));
    const external = slo('crash-free-sessions');
    expectRejected(withSlo({ ...external, alert: { ...external.alert, operator: 'gt' } }));
    expectRejected(withSlo({ ...external, alert: { ...external.alert, threshold: 0.999 } }));
    expect(
      validateSloDocument(withSlo({ alert: { ...ipc.alert, threshold: ipc.target.threshold } })),
    ).toEqual([]);
  });

  it('Sentry 只能显式 external，拒绝本地 metric/query 或伪装 OTel', () => {
    const external = slo('crash-free-sessions');
    expectRejected(
      withSlo({ ...external, query: { ...external.query, metric: 'app.renderer.crashes' } }),
    );
    expectRejected(
      withSlo({ ...external, query: { ...external.query, aggregation: 'ratio', filters: {} } }),
    );
    expectRejected(withSlo({ ...external, query: { ...external.query, source: 'sentry' } }));
    expectRejected(withSlo({ ...external, query: { ...external.query, source: 'otel' } }));
  });

  it('独立 count 告警不允许伪装 SLO 或自由条件', () => {
    expectRejected({
      ...doc,
      alerts: [{ ...countAlert, target: { operator: 'lte', threshold: 0, unit: '1' } }],
    });
    expectRejected(withSlo({ query: countAlert.query }));
    expectRejected({
      ...doc,
      alerts: [{ ...countAlert, alert: { ...countAlert.alert, operator: 'lt' } }],
    });
    expectRejected({
      ...doc,
      alerts: [{ ...countAlert, alert: { ...countAlert.alert, condition: '>0' } }],
    });
  });
});

interface Observation {
  readonly metric: string;
  readonly value: number;
  readonly attributes: Readonly<Record<string, string>>;
  readonly ageMinutes: number;
}

function matches(attributes: Observation['attributes'], filters: ObservabilityFilters): boolean {
  return Object.entries(filters).every(([key, values]) => {
    const value = attributes[key];
    return value !== undefined && values.includes(value);
  });
}

// Fixture 输入为窗口内 counter 增量或原始 histogram 观测，不模拟后端累计序列或桶插值。
function evaluateFixture(
  query: ObservabilitySloQuery | ObservabilityIncreaseQuery,
  observations: readonly Observation[],
): number | undefined {
  if (query.source === 'external') throw new Error('external query requires Sentry');
  const factor = query.window.endsWith('d') ? 1440 : query.window.endsWith('h') ? 60 : 1;
  const minutes = Number(query.window.slice(0, -1)) * factor;
  const selected = observations.filter(
    (item) =>
      item.metric === query.metric &&
      item.ageMinutes >= 0 &&
      item.ageMinutes < minutes &&
      matches(item.attributes, query.filters),
  );
  if (query.aggregation === 'percentile') {
    if (selected.length < query.minSamples) return undefined;
    const sorted = selected.map((item) => item.value).sort((left, right) => left - right);
    return sorted[Math.ceil((sorted.length * query.percentile) / 100) - 1];
  }
  const denominator = selected.reduce((sum, item) => sum + item.value, 0);
  if (denominator < query.minSamples) return undefined;
  if (query.aggregation === 'increase') return denominator;
  const numerator = selected
    .filter((item) => matches(item.attributes, query.numeratorFilters))
    .reduce((sum, item) => sum + item.value, 0);
  return numerator / denominator;
}

function observations(
  metric: string,
  value: number,
  attributes: Observation['attributes'],
  count = 1,
): Observation[] {
  return Array.from({ length: count }, () => ({ metric, value, attributes, ageMinutes: 0 }));
}

describe('pure semantic fixtures against shipped queries', () => {
  it.each(['db-backup-success', 'update-check-failure'])('100 次中 1 次错误等于 1%%：%s', (id) => {
    const entry = slo(id);
    if (entry.query.source !== 'otel') throw new Error('Expected OTel');
    const samples = [
      ...observations(entry.query.metric, 1, { outcome: 'success' }, 99),
      ...observations(entry.query.metric, 1, { outcome: 'error' }),
      ...observations('app.update.events', 1, { phase: 'error' }, 500),
    ];
    expect(evaluateFixture(entry.query, samples)).toBe(0.01);
    if (id === 'db-backup-success')
      expect(entry.target).toEqual({ operator: 'lte', threshold: 0.01, unit: '1' });
    if (id === 'update-check-failure') expect(entry.query.metric).toBe('app.update.checks');
  });

  it('IPC 分母排除 validation/business，跨 channel 汇总而非平均通道比例', () => {
    const samples = [
      ...observations(
        'ipc.server.requests',
        1,
        { channel: 'a', failureClass: 'none', outcome: 'success' },
        99,
      ),
      ...observations('ipc.server.requests', 1, {
        channel: 'b',
        failureClass: 'system',
        outcome: 'error',
      }),
      ...observations(
        'ipc.server.requests',
        1,
        { failureClass: 'validation', outcome: 'error' },
        300,
      ),
      ...observations(
        'ipc.server.requests',
        1,
        { failureClass: 'business', outcome: 'error' },
        300,
      ),
    ];
    expect(evaluateFixture(ipc.query, samples)).toBe(0.01);
  });

  it('300ms 仍是数值 300 而非 0.3，所有时长目标均使用 ms', () => {
    expect(
      evaluateFixture(latency.query, observations('ipc.server.request.duration', 300, {}, 100)),
    ).toBe(300);
    for (const [id, threshold] of [
      ['ipc-p95-latency', 300],
      ['startup-p95', 3000],
      ['update-download-p95', 10000],
      ['event-loop-p99', 200],
      ['web-vitals-lcp', 2500],
      ['web-vitals-inp', 200],
    ] as const) {
      expect(slo(id).target).toEqual({ operator: 'lte', threshold, unit: 'ms' });
    }
  });

  it('启动只选择前台 renderer-ready，不将其它阶段或隐藏启动混入分布', () => {
    const metric = 'app.startup.duration';
    const samples = [
      ...observations(metric, 3000, { phase: 'renderer-ready', mode: 'foreground' }, 20),
      ...observations(metric, 90000, { phase: 'renderer-ready', mode: 'hidden' }, 100),
      ...['services', 'window', 'ready-to-show'].flatMap((phase) =>
        observations(metric, 90000, { phase, mode: 'foreground' }, 100),
      ),
    ];
    expect(evaluateFixture(slo('startup-p95').query, samples)).toBe(3000);
  });

  it('下载只选择 downloaded，取消/错误耗时不参与', () => {
    const metric = 'app.update.download.duration';
    const samples = [
      ...observations(metric, 10000, { outcome: 'downloaded' }, 20),
      ...observations(metric, 100000, { outcome: 'cancelled' }, 100),
      ...observations(metric, 100000, { outcome: 'error' }, 100),
    ];
    expect(evaluateFixture(slo('update-download-p95').query, samples)).toBe(10000);
  });

  it('零数据/低流量/窗口外数据不告警', () => {
    expect(evaluateFixture(ipc.query, [])).toBeUndefined();
    const errors = observations('ipc.server.requests', 1, {
      failureClass: 'system',
      outcome: 'error',
    });
    expect(evaluateFixture(ipc.query, errors)).toBeUndefined();
    expect(
      evaluateFixture(
        ipc.query,
        Array.from({ length: 100 }, () => ({
          ...errors[0],
          metric: 'ipc.server.requests',
          value: 1,
          attributes: { failureClass: 'system', outcome: 'error' },
          ageMinutes: 60,
        })),
      ),
    ).toBeUndefined();
    expect(
      evaluateFixture(latency.query, observations('ipc.server.request.duration', 10000, {})),
    ).toBeUndefined();
  });

  it('计数告警只选 rebuilt/stopped，单次事件即可触发且不被健康事件稀释', () => {
    const samples = [
      ...observations('app.db.recovery', 1, { outcome: 'healthy' }, 500),
      ...observations('app.db.recovery', 1, { outcome: 'restored' }, 100),
      ...observations('app.db.recovery', 1, { outcome: 'rebuilt' }),
      ...observations('app.renderer.crashes', 1, { recovery: 'reload' }, 100),
      ...observations('app.renderer.crashes', 1, { recovery: 'stopped' }),
    ];
    for (const entry of doc.alerts) {
      expect(evaluateFixture(entry.query, samples)).toBe(1);
      expect(entry.alert).toMatchObject({ operator: 'gt', threshold: 0, severity: 'critical' });
      expect(
        evaluateFixture(
          entry.query,
          samples.filter(
            (item) =>
              item.attributes['outcome'] !== 'rebuilt' && item.attributes['recovery'] !== 'stopped',
          ),
        ),
      ).toBeUndefined();
    }
  });

  it('事件循环明确为 5 秒窗口 p99 的分布，Sentry 不伪装本地计算', () => {
    expect(slo('event-loop-p99').title).toBe('p99 of 5-second event-loop p99 samples');
    expect(() => evaluateFixture(slo('crash-free-sessions').query, [])).toThrow('requires Sentry');
  });
});

describe('findMissingSloDocs', () => {
  it('检查全部 SLO 及独立告警 id', () => {
    const allIds = [...doc.slos, ...doc.alerts].map((entry) => entry.id).join('\n');
    expect(findMissingSloDocs(doc, allIds)).toEqual([]);
    expect(findMissingSloDocs(doc, doc.slos.map((entry) => entry.id).join('\n'))).toEqual([
      '运行手册缺少 SLO/告警：db-recovery-rebuilt',
      '运行手册缺少 SLO/告警：renderer-recovery-stopped',
    ]);
    expect(findMissingSloDocs(doc, '')).toHaveLength(13);
  });
});
