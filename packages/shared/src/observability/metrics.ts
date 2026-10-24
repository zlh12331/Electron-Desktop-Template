/** 可观测性指标名（单一真源：instrument 创建、SLO 定义、文档校验共用） */
export const OBSERVABILITY_METRICS = {
  ipcRequests: 'ipc.server.requests',
  ipcRequestDuration: 'ipc.server.request.duration',
  startupDuration: 'app.startup.duration',
  updateEvents: 'app.update.events',
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

/** 全部指标名（SLO/文档校验的扁平集合） */
export const OBSERVABILITY_METRIC_NAMES: readonly string[] = [
  ...Object.values(OBSERVABILITY_METRICS),
  ...Object.values(WEB_VITAL_METRICS),
];
