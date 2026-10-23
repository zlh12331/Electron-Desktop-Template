/** 遥测级别（与设置页/持久化文件一致） */
export const TELEMETRY_LEVELS = ['off', 'error-only', 'full'] as const;

/** 遥测级别类型 */
export type TelemetryLevel = (typeof TELEMETRY_LEVELS)[number];

/** 默认遥测级别（设置页未写文件时） */
export const DEFAULT_TELEMETRY_LEVEL: TelemetryLevel = 'full';
