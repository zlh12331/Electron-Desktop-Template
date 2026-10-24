import type { ObservabilityMetricDefinition } from '@code-agent/shared/observability';

/** 同键取值为 OR，不同键为 AND；空对象匹配所有观测。 */
export type ObservabilityFilters = Readonly<Record<string, readonly string[]>>;

interface QueryWindow {
  readonly window: string;
  readonly minSamples: number;
}

interface OtelQueryBase extends QueryWindow {
  readonly source: 'otel';
  readonly metric: string;
  readonly filters: ObservabilityFilters;
}

/** 分子完整声明过滤范围；对窗口内各序列的 counter increase 求和后相除。 */
export interface ObservabilityRatioQuery extends OtelQueryBase {
  readonly aggregation: 'ratio';
  readonly numeratorFilters: ObservabilityFilters;
}

/** 百分位在筛选后的合并 histogram 分布上计算，不平均各序列百分位。 */
export interface ObservabilityPercentileQuery extends OtelQueryBase {
  readonly aggregation: 'percentile';
  readonly percentile: number;
}

/** 窗口内各序列的 counter increase 之和，必须处理进程重启导致的重置。 */
export interface ObservabilityIncreaseQuery extends OtelQueryBase {
  readonly aggregation: 'increase';
}

/** 外部会话统计只能由 Sentry 求值，不能由本地 OTel 指标代算。 */
export interface ObservabilityExternalQuery extends QueryWindow {
  readonly source: 'external';
  readonly provider: 'sentry';
  readonly indicator: 'crash-free-sessions';
}

/** minSamples 为窗口内分母事件数或 histogram 观测数；不足时不告警。 */
export type ObservabilitySloQuery =
  | ObservabilityRatioQuery
  | ObservabilityPercentileQuery
  | ObservabilityExternalQuery;

/** 告警沿目标违约方向触发，threshold 与目标使用同一单位。 */
export interface ObservabilitySloAlert {
  readonly for: string;
  readonly operator: 'gt' | 'lt';
  readonly threshold: number;
  readonly severity: 'info' | 'warning' | 'critical';
}

interface EntryMetadata {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/** 单条目标，不混入仅计数的事故告警。 */
export interface ObservabilitySlo extends EntryMetadata {
  readonly query: ObservabilitySloQuery;
  readonly target: {
    readonly operator: 'lte' | 'gte';
    readonly threshold: number;
    readonly unit: ObservabilityMetricDefinition['unit'];
  };
  readonly alert: ObservabilitySloAlert;
}

/** 独立计数告警；minSamples 为筛选后的事件数。 */
export interface ObservabilityCountAlert extends EntryMetadata {
  readonly query: ObservabilityIncreaseQuery;
  readonly unit: '1';
  readonly alert: ObservabilitySloAlert & { readonly operator: 'gt' };
}

/** 后端无关契约，不表示告警已经部署到任何后端。 */
export interface ObservabilitySloDocument {
  readonly version: 2;
  readonly updatedAt: string;
  readonly description?: string;
  readonly slos: readonly ObservabilitySlo[];
  readonly alerts: readonly ObservabilityCountAlert[];
}
