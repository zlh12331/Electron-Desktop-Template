/** 可观测性指标名（单一真源：instrument 创建、SLO 定义、文档校验共用） */
export const OBSERVABILITY_METRICS = {
  ipcRequests: 'ipc.server.requests',
  ipcRequestDuration: 'ipc.server.request.duration',
  startupDuration: 'app.startup.duration',
  updateEvents: 'app.update.events',
  updateChecks: 'app.update.checks',
  updateCheckDuration: 'app.update.check.duration',
  updateDownloadDuration: 'app.update.download.duration',
  eventLoopDelay: 'nodejs.eventloop.delay',
  memoryGrowth: 'nodejs.memory.growth',
  processMemoryUsage: 'process.memory.usage',
  electronProcessMemory: 'electron.process.memory',
  electronProcessCpu: 'electron.process.cpu',
  dbRecovery: 'app.db.recovery',
  dbBackup: 'app.db.backup',
  dbBackupDuration: 'app.db.backup.duration',
  rendererCrashes: 'app.renderer.crashes',
} as const;

/** 渲染层 Web Vitals 指标名（CLS 无量纲，其余为毫秒） */
export const WEB_VITAL_METRICS = {
  ['CLS']: 'web_vitals.cls',
  ['FCP']: 'web_vitals.fcp',
  ['INP']: 'web_vitals.inp',
  ['LCP']: 'web_vitals.lcp',
  ['TTFB']: 'web_vitals.ttfb',
} as const;

/** 指标注册表必须恰好覆盖两组公开名称。 */
export type ObservabilityMetricName =
  | (typeof OBSERVABILITY_METRICS)[keyof typeof OBSERVABILITY_METRICS]
  | (typeof WEB_VITAL_METRICS)[keyof typeof WEB_VITAL_METRICS];

/** 空属性值数组表示动态字符串，不表示该属性不存在。 */
export interface ObservabilityMetricDefinition {
  readonly type: 'counter' | 'histogram' | 'gauge';
  readonly unit: '1' | 'ms' | 'By' | 'MB' | 'percent';
  readonly attributes: Readonly<Record<string, readonly string[]>>;
}

const ipcAttributes = {
  channel: [],
  outcome: ['success', 'error'],
  failureClass: ['none', 'validation', 'business', 'system'],
} as const;
const updateCheckAttributes = {
  trigger: ['launch', 'manual', 'retry', 'long-session'],
  outcome: ['success', 'error'],
} as const;
const processAttributes = {
  'process.type': [
    'Browser',
    'Tab',
    'Utility',
    'Zygote',
    'Sandbox helper',
    'GPU',
    'Pepper Plugin',
    'Pepper Plugin Broker',
    'Unknown',
  ],
  'process.name': [],
} as const;
const webVitalAttributes = {
  rating: ['good', 'needs-improvement', 'poor'],
  'navigation.type': [],
} as const;

/** 仪表单位与属性值域由采集端和 SLO 校验共用。 */
export const OBSERVABILITY_METRIC_DEFINITIONS: Readonly<
  Record<ObservabilityMetricName, ObservabilityMetricDefinition>
> = {
  [OBSERVABILITY_METRICS.ipcRequests]: { type: 'counter', unit: '1', attributes: ipcAttributes },
  [OBSERVABILITY_METRICS.ipcRequestDuration]: {
    type: 'histogram',
    unit: 'ms',
    attributes: ipcAttributes,
  },
  [OBSERVABILITY_METRICS.startupDuration]: {
    type: 'histogram',
    unit: 'ms',
    attributes: {
      phase: ['services', 'window', 'ready-to-show', 'renderer-ready'],
      mode: ['foreground', 'hidden'],
    },
  },
  [OBSERVABILITY_METRICS.updateEvents]: {
    type: 'counter',
    unit: '1',
    attributes: {
      phase: ['checking', 'available', 'not-available', 'downloaded', 'cancelled', 'error'],
    },
  },
  [OBSERVABILITY_METRICS.updateChecks]: {
    type: 'counter',
    unit: '1',
    attributes: updateCheckAttributes,
  },
  [OBSERVABILITY_METRICS.updateCheckDuration]: {
    type: 'histogram',
    unit: 'ms',
    attributes: updateCheckAttributes,
  },
  [OBSERVABILITY_METRICS.updateDownloadDuration]: {
    type: 'histogram',
    unit: 'ms',
    attributes: { outcome: ['downloaded', 'cancelled', 'error'] },
  },
  [OBSERVABILITY_METRICS.eventLoopDelay]: { type: 'histogram', unit: 'ms', attributes: {} },
  [OBSERVABILITY_METRICS.memoryGrowth]: {
    type: 'histogram',
    unit: 'MB',
    attributes: { window: [] },
  },
  [OBSERVABILITY_METRICS.processMemoryUsage]: {
    type: 'gauge',
    unit: 'By',
    attributes: { state: ['rss', 'heap_used', 'heap_total', 'external', 'array_buffers'] },
  },
  [OBSERVABILITY_METRICS.electronProcessMemory]: {
    type: 'gauge',
    unit: 'By',
    attributes: processAttributes,
  },
  [OBSERVABILITY_METRICS.electronProcessCpu]: {
    type: 'gauge',
    unit: 'percent',
    attributes: processAttributes,
  },
  [OBSERVABILITY_METRICS.dbRecovery]: {
    type: 'counter',
    unit: '1',
    attributes: { outcome: ['healthy', 'restored', 'rebuilt'] },
  },
  [OBSERVABILITY_METRICS.dbBackup]: {
    type: 'counter',
    unit: '1',
    attributes: { outcome: ['success', 'error'] },
  },
  [OBSERVABILITY_METRICS.dbBackupDuration]: {
    type: 'histogram',
    unit: 'ms',
    attributes: { outcome: ['success', 'error'] },
  },
  [OBSERVABILITY_METRICS.rendererCrashes]: {
    type: 'counter',
    unit: '1',
    attributes: {
      reason: [
        'abnormal-exit',
        'killed',
        'crashed',
        'oom',
        'launch-failed',
        'integrity-failure',
        'unknown',
      ],
      recovery: ['reload', 'stopped'],
    },
  },
  [WEB_VITAL_METRICS.CLS]: { type: 'histogram', unit: '1', attributes: webVitalAttributes },
  [WEB_VITAL_METRICS.FCP]: { type: 'histogram', unit: 'ms', attributes: webVitalAttributes },
  [WEB_VITAL_METRICS.INP]: { type: 'histogram', unit: 'ms', attributes: webVitalAttributes },
  [WEB_VITAL_METRICS.LCP]: { type: 'histogram', unit: 'ms', attributes: webVitalAttributes },
  [WEB_VITAL_METRICS.TTFB]: { type: 'histogram', unit: 'ms', attributes: webVitalAttributes },
};

/** 全部指标名从描述符派生，不能独立增删。 */
export const OBSERVABILITY_METRIC_NAMES: readonly ObservabilityMetricName[] = Object.keys(
  OBSERVABILITY_METRIC_DEFINITIONS,
) as ObservabilityMetricName[];
