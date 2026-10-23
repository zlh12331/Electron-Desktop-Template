/** SLO 定义 JSON 的 TypeScript 形状（scripts 校验与测试共用） */
export interface ObservabilitySloAlert {
  readonly for: string;
  readonly condition: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

/** 单条 SLO 定义 */
export interface ObservabilitySlo {
  readonly id: string;
  readonly title: string;
  readonly source: 'sentry' | 'otel';
  readonly metric: string | null;
  readonly aggregation: string | null;
  readonly target: number;
  readonly unit: 'ratio' | 'seconds' | 'score';
  readonly window: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly description: string;
  readonly alert: ObservabilitySloAlert;
}

/** SLO 文档根 */
export interface ObservabilitySloDocument {
  readonly version: 1;
  readonly updatedAt: string;
  readonly description?: string;
  readonly slos: readonly ObservabilitySlo[];
}
