import { describe, expect, it } from 'vitest';

import { findMissingSloDocs, validateSloDocument } from './observability-slo';
import type { ObservabilitySloDocument } from './observability-slo-types';

const doc: ObservabilitySloDocument = {
  version: 1,
  updatedAt: '2026-10-24',
  slos: [
    {
      id: 'ipc-error-rate',
      title: 'IPC error rate',
      source: 'otel',
      metric: 'ipc.server.requests',
      aggregation: 'error-rate',
      target: 0.005,
      unit: 'ratio',
      window: '1h',
      severity: 'critical',
      description: 'IPC 错误率',
      alert: { for: '5m', condition: '> 0.05', severity: 'critical' },
    },
  ],
};

const metrics = new Set(['ipc.server.requests']);

const firstSlo = doc.slos[0];
if (firstSlo === undefined) {
  throw new Error('fixture slos empty');
}

describe('validateSloDocument', () => {
  it('合法文档通过', () => {
    expect(validateSloDocument(doc, metrics)).toEqual([]);
  });

  it('未知指标/重复 id/非法窗口/非法 target 均被报告', () => {
    const bad = {
      ...doc,
      slos: [
        {
          ...firstSlo,
          metric: 'unknown.metric',
          window: '1year',
          target: 2,
          severity: 'fatal',
        },
        { ...firstSlo },
      ],
    };
    const problems = validateSloDocument(bad, metrics);
    expect(problems.some((problem) => problem.includes('未在指标注册表'))).toBe(true);
    expect(problems.some((problem) => problem.includes('window'))).toBe(true);
    expect(problems.some((problem) => problem.includes('target'))).toBe(true);
    expect(problems.some((problem) => problem.includes('severity'))).toBe(true);
    expect(problems.some((problem) => problem.includes('重复'))).toBe(true);
  });

  it('sentry 源不允许 metric；版本/空数组被拒', () => {
    expect(
      validateSloDocument({ version: 2, slos: [] }, metrics).some((problem) =>
        problem.includes('version'),
      ),
    ).toBe(true);
    expect(validateSloDocument({ version: 1, slos: [] }, metrics)).toContain('slos 必须是非空数组');
    expect(
      validateSloDocument(
        {
          version: 1,
          slos: [
            {
              ...firstSlo,
              id: 'sentry-with-metric',
              source: 'sentry',
              metric: 'ipc.server.requests',
            },
          ],
        },
        metrics,
      ).some((problem) => problem.includes('metric 必须为 null')),
    ).toBe(true);
  });
});

describe('findMissingSloDocs', () => {
  it('运行手册缺少 id 时报告', () => {
    expect(findMissingSloDocs(doc, 'ipc-error-rate')).toEqual([]);
    expect(findMissingSloDocs(doc, 'nothing')).toEqual(['运行手册缺少 SLO：ipc-error-rate']);
  });
});
