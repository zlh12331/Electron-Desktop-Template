/** 遥测级别（与设置页/持久化文件一致） */
export const TELEMETRY_LEVELS = ['off', 'error-only', 'full'] as const;

/** 遥测级别类型 */
export type TelemetryLevel = (typeof TELEMETRY_LEVELS)[number];

/** 未明确选择时不启用网络遥测。 */
export const DEFAULT_TELEMETRY_LEVEL: TelemetryLevel = 'off';

/** 解析持久化偏好；缺失或损坏时拒绝默认外发。 */
export function resolveTelemetryPreference(value: unknown): TelemetryLevel {
  if (value !== null && typeof value === 'object' && 'level' in value) {
    const level = value.level;
    if (level === 'off' || level === 'error-only' || level === 'full') {
      return level;
    }
  }
  return DEFAULT_TELEMETRY_LEVEL;
}
