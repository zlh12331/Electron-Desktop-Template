import {
  OBSERVABILITY_METRIC_DEFINITIONS,
  type ObservabilityMetricDefinition,
} from '@code-agent/shared/observability';
import { z } from 'zod';

import type {
  ObservabilityFilters,
  ObservabilityIncreaseQuery,
  ObservabilityPercentileQuery,
  ObservabilityRatioQuery,
  ObservabilitySlo,
  ObservabilitySloDocument,
} from './observability-slo-types';

type MetricRegistry = Readonly<Record<string, ObservabilityMetricDefinition>>;
type OtelQuery =
  | ObservabilityRatioQuery
  | ObservabilityPercentileQuery
  | ObservabilityIncreaseQuery;

const nonEmptyText = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), '不允许首尾空白');
const nonNegativeNumber = z.number().finite().nonnegative();
const windowSchema = z
  .string()
  .regex(/^[1-9]\d*(?:m|h|d)$/)
  .refine(
    (value) => Number.isSafeInteger(Number(value.slice(0, -1)) * 86_400),
    '窗口必须是安全范围内的正整数分钟/小时/天',
  );
// Zod record 会丢弃 __proto__，须在解析前拒绝，防止选择器被静默扩大。
const filtersSchema = z
  .unknown()
  .refine(
    (value) => value === null || typeof value !== 'object' || !Object.hasOwn(value, '__proto__'),
    '非法 filter 键：__proto__',
  )
  .pipe(
    z.record(
      nonEmptyText,
      z
        .array(nonEmptyText)
        .min(1)
        .refine((values) => new Set(values).size === values.length, 'filter 取值不能重复'),
    ),
  );
const queryWindow = { window: windowSchema, minSamples: z.number().int().positive() };
const otelQueryBase = {
  ...queryWindow,
  source: z.literal('otel'),
  metric: nonEmptyText,
  filters: filtersSchema,
};
const ratioQuerySchema = z.strictObject({
  ...otelQueryBase,
  aggregation: z.literal('ratio'),
  numeratorFilters: filtersSchema.refine((filters) => Object.keys(filters).length > 0),
});
const percentileQuerySchema = z.strictObject({
  ...otelQueryBase,
  aggregation: z.literal('percentile'),
  percentile: z.number().finite().gt(0).lte(100),
});
const increaseQuerySchema = z.strictObject({
  ...otelQueryBase,
  aggregation: z.literal('increase'),
});
const externalQuerySchema = z.strictObject({
  ...queryWindow,
  source: z.literal('external'),
  provider: z.literal('sentry'),
  indicator: z.literal('crash-free-sessions'),
});
const alertShape = {
  for: windowSchema,
  operator: z.enum(['gt', 'lt']),
  threshold: nonNegativeNumber,
  severity: z.enum(['info', 'warning', 'critical']),
};
const metadataShape = {
  id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  title: nonEmptyText,
  description: nonEmptyText,
};
const documentSchema = z.strictObject({
  version: z.literal(2),
  updatedAt: z.iso.date(),
  description: nonEmptyText.optional(),
  slos: z
    .array(
      z.strictObject({
        ...metadataShape,
        query: z.union([ratioQuerySchema, percentileQuerySchema, externalQuerySchema]),
        target: z.strictObject({
          operator: z.enum(['lte', 'gte']),
          threshold: nonNegativeNumber,
          unit: z.enum(['1', 'ms', 'By', 'MB', 'percent']),
        }),
        alert: z.strictObject(alertShape),
      }),
    )
    .min(1),
  alerts: z.array(
    z.strictObject({
      ...metadataShape,
      query: increaseQuerySchema,
      unit: z.literal('1'),
      alert: z.strictObject({ ...alertShape, operator: z.literal('gt') }),
    }),
  ),
});

function validateFilters(
  filters: ObservabilityFilters,
  definition: ObservabilityMetricDefinition,
  prefix: string,
): string[] {
  const problems: string[] = [];
  for (const [key, values] of Object.entries(filters)) {
    if (!Object.hasOwn(definition.attributes, key)) {
      problems.push(`${prefix}.${key} 非法 filter 键`);
      continue;
    }
    const allowed = definition.attributes[key];
    if (
      allowed !== undefined &&
      allowed.length > 0 &&
      values.some((value) => !allowed.includes(value))
    ) {
      problems.push(`${prefix}.${key} 非法 filter 值`);
    }
  }
  return problems;
}

function validateNumerator(query: ObservabilityRatioQuery, prefix: string): string[] {
  return Object.entries(query.filters).flatMap(([key, denominator]) => {
    const numerator = Object.hasOwn(query.numeratorFilters, key)
      ? query.numeratorFilters[key]
      : undefined;
    if (numerator === undefined || numerator.some((value) => !denominator.includes(value))) {
      return [`${prefix}.numeratorFilters.${key} 分子必须属于分母过滤范围`];
    }
    return [];
  });
}

function validateOtelQuery(query: OtelQuery, registry: MetricRegistry, prefix: string): string[] {
  const definition = Object.hasOwn(registry, query.metric) ? registry[query.metric] : undefined;
  if (definition === undefined) {
    return [`${prefix}.metric 未在指标注册表中：${query.metric}`];
  }
  const problems = validateFilters(query.filters, definition, `${prefix}.filters`);
  const requiredType = query.aggregation === 'percentile' ? 'histogram' : 'counter';
  if (definition.type !== requiredType) {
    problems.push(`${prefix}.aggregation=${query.aggregation} 要求 ${requiredType} 仪表`);
  }
  if (query.aggregation === 'ratio') {
    problems.push(
      ...validateFilters(query.numeratorFilters, definition, `${prefix}.numeratorFilters`),
      ...validateNumerator(query, prefix),
    );
  }
  return problems;
}

function validateTarget(slo: ObservabilitySlo, registry: MetricRegistry, prefix: string): string[] {
  const { query, target, alert } = slo;
  const problems: string[] = [];
  const isRatio = query.source === 'external' || query.aggregation === 'ratio';
  const expectedUnit = isRatio ? '1' : registry[query.metric]?.unit;
  if (expectedUnit !== undefined && target.unit !== expectedUnit) {
    problems.push(`${prefix}.target.unit 必须与 query 单位一致：${expectedUnit}`);
  }
  if (isRatio && (target.threshold > 1 || alert.threshold > 1)) {
    problems.push(`${prefix} 比例 target/alert.threshold 必须在 0..1`);
  }
  const upperBound = target.operator === 'lte';
  if (alert.operator !== (upperBound ? 'gt' : 'lt')) {
    problems.push(`${prefix}.alert.operator 与 target 方向矛盾`);
  } else if (upperBound ? alert.threshold < target.threshold : alert.threshold > target.threshold) {
    problems.push(`${prefix}.alert.threshold 必须在目标之外`);
  }
  return problems;
}

/** 先严格解析未知 JSON，再验证仪表类型、单位、过滤集合与目标方向。 */
export function validateSloDocument(
  doc: unknown,
  registry: MetricRegistry = OBSERVABILITY_METRIC_DEFINITIONS,
): readonly string[] {
  const result = documentSchema.safeParse(doc);
  if (!result.success) {
    return result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`,
    );
  }
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const entry of [...result.data.slos, ...result.data.alerts]) {
    if (ids.has(entry.id)) problems.push(`id 重复：${entry.id}`);
    ids.add(entry.id);
    if (entry.query.source === 'otel') {
      problems.push(...validateOtelQuery(entry.query, registry, entry.id));
    }
  }
  for (const slo of result.data.slos) {
    problems.push(...validateTarget(slo, registry, slo.id));
  }
  for (const entry of result.data.alerts) {
    if (registry[entry.query.metric]?.unit !== entry.unit) {
      problems.push(`${entry.id}.unit 必须与 counter 单位一致：1`);
    }
  }
  return problems;
}

/** SLO 和独立计数告警的全部 id 都必须在运行手册登记。 */
export function findMissingSloDocs(
  doc: ObservabilitySloDocument,
  runbook: string,
): readonly string[] {
  return [...doc.slos, ...doc.alerts]
    .filter((entry) => !runbook.includes(entry.id))
    .map((entry) => `运行手册缺少 SLO/告警：${entry.id}`);
}
