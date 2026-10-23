// instrument-exporter.ts：给 OTel exporter 包一层结果回调，记录导出成功/失败
// 边界：只包装 export()，不改导出器行为；Console exporter 不经过这里
import { recordExportResult, type TelemetrySignal } from './telemetry-health';

interface ExportResultLike {
  readonly code: number;
  readonly error?: Error | undefined;
}

interface ExportCapable {
  export(items: unknown, callback: (result: ExportResultLike) => void): void;
}

/**
 * 包装 exporter.export：每次回调记录健康状态，再把原始结果交还 SDK
 *
 * @param exporter OTel exporter 实例
 * @param signal 信号名（traces/metrics/logs）
 * @returns 同一个 exporter（原地替换 export 方法）
 */
export function instrumentExporter<T extends ExportCapable>(
  exporter: T,
  signal: TelemetrySignal,
): T {
  const original = exporter.export.bind(exporter);
  exporter.export = ((items: unknown, callback: (result: ExportResultLike) => void): void => {
    try {
      original(items, (result) => {
        recordExportResult(signal, result.code === 0, result.error);
        callback(result);
      });
    } catch (error) {
      recordExportResult(signal, false, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }) as T['export'];
  return exporter;
}
