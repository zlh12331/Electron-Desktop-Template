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

/** 导出前移除代理 URL 内的 userinfo，防止旧库/异常数据把凭据写进备份文件 */
export function redactProxyCredentialsInSettings(
  settings: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const proxy = settings['proxy'];
  if (typeof proxy !== 'object' || proxy === null || Array.isArray(proxy)) {
    return { ...settings };
  }
  const url = (proxy as { readonly url?: unknown }).url;
  if (typeof url !== 'string') {
    return { ...settings };
  }
  return {
    ...settings,
    proxy: { ...proxy, url: url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, '$1') },
  };
}

export function buildSettingsExportFile(): SettingsExportFile {
  return {
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: Date.now(),
    settings: redactProxyCredentialsInSettings(readAllSettings()),
  };
}

/** 校验导入文件并返回将要写入的条目（不落库；供 handler 在写入前做凭据规范化） */
export function validateSettingsImport(payload: unknown): SettingsImportOutcome {
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
  return { imported: applied.length, skipped, applied };
}

/**
 * 替换导入 payload 中某个设置的值（保持其余字段与未知键不变）
 *
 * 返回新对象，不修改调用方传入的结构。
 */
export function replaceSettingInImportPayload(
  payload: unknown,
  key: SettingKey,
  value: unknown,
): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const settings = (payload as { readonly settings?: unknown }).settings;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return payload;
  }
  return { ...payload, settings: { ...settings, [key]: value } };
}

export function applySettingsImport(payload: unknown): SettingsImportOutcome {
  const outcome = validateSettingsImport(payload);
  writeSettings(outcome.applied);
  logger.info(
    { imported: outcome.imported, skipped: outcome.skipped },
    '设置导入完成（白名单外键跳过）',
  );
  return outcome;
}
