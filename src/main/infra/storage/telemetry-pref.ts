// telemetry-pref.ts：遥测级别持久化（JSON 文件而非 SQLite）——启动序列在 initDb **之前**
// 决定是否初始化 OTel，此文件必须可同步读取
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_TELEMETRY_LEVEL,
  TELEMETRY_LEVELS,
  type TelemetryLevel,
} from '@code-agent/shared/observability';
import { app } from 'electron';
import { logger } from '../../utils/logger';

function getPrefPath(): string {
  return join(app.getPath('userData'), 'telemetry-pref.json');
}

interface TelemetryPref {
  level: TelemetryLevel;
}

/** 同步读遥测级别（文件缺失/损坏/值域外一律回落默认，不阻塞启动） */
export function readTelemetryLevelSync(): TelemetryLevel {
  try {
    const path = getPrefPath();
    if (!existsSync(path)) {
      return DEFAULT_TELEMETRY_LEVEL;
    }
    const content = readFileSync(path, 'utf8');
    const pref = JSON.parse(content) as Partial<TelemetryPref>;
    const level = pref.level;
    if (level !== undefined && TELEMETRY_LEVELS.includes(level)) {
      return level;
    }
    logger.warn({ value: String(level).slice(0, 80) }, '遥测级别值非法，回落默认级别');
    return DEFAULT_TELEMETRY_LEVEL;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      '遥测偏好读取失败，回落默认级别',
    );
    return DEFAULT_TELEMETRY_LEVEL;
  }
}

/** 写遥测级别（0600 创建——级别本身不敏感，但保持与同目录凭据文件一致的权限习惯） */
export async function writeTelemetryLevel(level: TelemetryLevel): Promise<void> {
  const path = getPrefPath();
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const pref: TelemetryPref = { level };
  writeFileSync(path, JSON.stringify(pref, null, 2), { encoding: 'utf8', mode: 0o600 });
}
