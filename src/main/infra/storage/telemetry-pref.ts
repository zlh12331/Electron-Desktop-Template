import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_TELEMETRY_LEVEL,
  resolveTelemetryPreference,
  type TelemetryLevel,
} from '@code-agent/shared/observability';
import { app } from 'electron';
import { logger } from '../../utils/logger';

function getPrefPath(): string {
  return join(app.getPath('userData'), 'telemetry-pref.json');
}

/** 启动前同步读取用户选择；缺失或损坏时关闭网络遥测。 */
export function readTelemetryLevelSync(): TelemetryLevel {
  try {
    return resolveTelemetryPreference(JSON.parse(readFileSync(getPrefPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ scope: 'telemetry-pref' }, '遥测偏好读取失败，关闭网络遥测');
    }
    return DEFAULT_TELEMETRY_LEVEL;
  }
}

/** 原子保存选择，避免中断写入破坏已有同意记录。 */
export async function writeTelemetryLevel(level: TelemetryLevel): Promise<void> {
  const path = getPrefPath();
  mkdirSync(dirname(path), { recursive: true });
  const pendingPath = `${path}.tmp`;
  writeFileSync(pendingPath, JSON.stringify({ level }), { encoding: 'utf8', mode: 0o600 });
  renameSync(pendingPath, path);
}
