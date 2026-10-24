import type { SettingKey, SettingsExportFile } from '@code-agent/shared/main';
import {
  AppError,
  ErrorCode,
  SETTING_KEYS,
  SETTING_VALUE_SCHEMAS,
  SETTINGS_EXPORT_VERSION,
  SettingsExportFileSchema,
} from '@code-agent/shared/main';
import { logger } from '../../utils/logger';
import { readAllSettings, writeSettings } from './settings-pref';

interface AppliedSetting {
  readonly key: SettingKey;
  readonly value: unknown;
}

export interface SettingsImportOutcome {
  readonly imported: number;
  readonly skipped: number;
  readonly applied: readonly AppliedSetting[];
}

export function buildSettingsExportFile(): SettingsExportFile {
  return {
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: Date.now(),
    settings: readAllSettings(),
  };
}

export function applySettingsImport(payload: unknown): SettingsImportOutcome {
  const parsed = SettingsExportFileSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `设置文件格式校验失败（仅支持 version=${SETTINGS_EXPORT_VERSION} 导出格式）`,
      parsed.error,
    );
  }
  const whitelist = new Set<string>(SETTING_KEYS);
  const applied: AppliedSetting[] = [];
  const invalid: Array<{ key: string; issues: unknown }> = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(parsed.data.settings)) {
    if (!whitelist.has(key)) {
      skipped += 1;
      continue;
    }
    const settingKey = key as SettingKey;
    const parsedValue = SETTING_VALUE_SCHEMAS[settingKey].safeParse(value);
    if (!parsedValue.success) {
      invalid.push({ key, issues: parsedValue.error.issues });
      continue;
    }
    applied.push({ key: settingKey, value });
  }
  if (invalid.length > 0) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `设置文件包含非法值（未写入任何设置）：${invalid.map((entry) => entry.key).join(', ')}`,
      undefined,
      { invalid },
    );
  }
  writeSettings(applied);
  logger.info({ imported: applied.length, skipped }, '设置导入完成（白名单外键跳过）');
  return { imported: applied.length, skipped, applied };
}
