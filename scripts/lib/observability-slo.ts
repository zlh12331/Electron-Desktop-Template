// observability-slo.ts：SLO/告警定义 JSON 的纯校验逻辑
import type { ObservabilitySloDocument } from './observability-slo-types';

/** 合法聚合方式 */
export const SLO_AGGREGATIONS = ['error-rate', 'p75', 'p95', 'p99', 'average'] as const;

/** 合法单位 */
export const SLO_UNITS = ['ratio', 'seconds', 'score'] as const;

/** 窗口格式：30m / 1h / 7d */
const WINDOW_PATTERN = /^\d+(?:m|h|d)$/;

/** id 形态：kebab-case */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const SEVERITIES = ['info', 'warning', 'critical'] as const;

/** 校验 SLO 文档；返回问题字符串（空数组 = 通过） */
export function validateSloDocument(
  doc: unknown,
  knownMetrics: ReadonlySet<string>,
): readonly string[] {
  const problems: string[] = [];
  if (doc === null || typeof doc !== 'object') {
    return ['SLO 文档不是对象'];
  }
  const parsed = doc as Partial<ObservabilitySloDocument>;
  if (parsed.version !== 1) {
    problems.push('version 必须为 1');
  }
  if (!Array.isArray(parsed.slos) || parsed.slos.length === 0) {
    return [...problems, 'slos 必须是非空数组'];
  }

  const ids = new Set<string>();
  for (const [index, slo] of parsed.slos.entries()) {
    const prefix = `slos[${index}]`;
    if (typeof slo.id !== 'string' || !ID_PATTERN.test(slo.id)) {
      problems.push(`${prefix}.id 必须是 kebab-case`);
    } else if (ids.has(slo.id)) {
      problems.push(`${prefix}.id 重复：${slo.id}`);
    } else {
      ids.add(slo.id);
    }
    if (typeof slo.title !== 'string' || slo.title.trim() === '') {
      problems.push(`${prefix}.title 不能为空`);
    }
    if (slo.source !== 'sentry' && slo.source !== 'otel') {
      problems.push(`${prefix}.source 必须是 sentry/otel`);
    }
    if (slo.source === 'otel') {
      if (typeof slo.metric !== 'string' || !knownMetrics.has(slo.metric)) {
        problems.push(`${prefix}.metric 未在指标注册表中：${String(slo.metric)}`);
      }
      if (
        typeof slo.aggregation !== 'string' ||
        !(SLO_AGGREGATIONS as readonly string[]).includes(slo.aggregation)
      ) {
        problems.push(`${prefix}.aggregation 非法`);
      }
    } else if (slo.metric !== null) {
      problems.push(`${prefix}.source=sentry 时 metric 必须为 null`);
    }
    if (typeof slo.target !== 'number' || slo.target < 0) {
      problems.push(`${prefix}.target 必须是非负数`);
    } else if (slo.unit === 'ratio' && slo.target > 1) {
      problems.push(`${prefix}.target 为 ratio 时必须在 0..1`);
    }
    if (typeof slo.unit !== 'string' || !(SLO_UNITS as readonly string[]).includes(slo.unit)) {
      problems.push(`${prefix}.unit 非法`);
    }
    if (typeof slo.window !== 'string' || !WINDOW_PATTERN.test(slo.window)) {
      problems.push(`${prefix}.window 必须形如 30m/1h/7d`);
    }
    if (
      typeof slo.severity !== 'string' ||
      !(SEVERITIES as readonly string[]).includes(slo.severity)
    ) {
      problems.push(`${prefix}.severity 非法`);
    }
    if (typeof slo.description !== 'string' || slo.description.trim() === '') {
      problems.push(`${prefix}.description 不能为空`);
    }
    if (
      slo.alert === null ||
      typeof slo.alert !== 'object' ||
      typeof slo.alert.for !== 'string' ||
      !WINDOW_PATTERN.test(slo.alert.for) ||
      typeof slo.alert.condition !== 'string' ||
      slo.alert.condition.trim() === '' ||
      !(SEVERITIES as readonly string[]).includes(slo.alert.severity)
    ) {
      problems.push(`${prefix}.alert 结构非法`);
    }
  }
  return problems;
}

/** 每个 SLO id 必须出现在运行手册中（防文档与机器定义漂移） */
export function findMissingSloDocs(
  doc: ObservabilitySloDocument,
  runbook: string,
): readonly string[] {
  return doc.slos
    .filter((slo) => !runbook.includes(slo.id))
    .map((slo) => `运行手册缺少 SLO：${slo.id}`);
}
