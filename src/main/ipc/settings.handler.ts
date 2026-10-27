// settings.handler.ts：settings 域 IPC——设置读写 + 副作用分发 + 遥测级别 + 设置导入导出/重置
// 注意：set 是「写穿透 + 按键分发副作用」模式，新增带主进程副作用的键必须在这里补分支
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type InferHandlers, type IPC_DEFINITIONS, SETTING_KEYS } from '@code-agent/shared/main';
import { app, dialog } from 'electron';

import { setMainLanguage, t } from '../infra/i18n';
import {
  applyProxySetting,
  clearProxyAuthCredentials,
  enrichProxySetting,
  sanitizeProxySetting,
} from '../infra/network/proxy-credentials';
import {
  applySettingsImport,
  buildSettingsExportFile,
  replaceSettingInImportPayload,
  validateSettingsImport,
} from '../infra/storage/settings-io';
import { deleteSettings, readAllSettings, writeSetting } from '../infra/storage/settings-pref';
import { readTelemetryLevelSync, writeTelemetryLevel } from '../infra/storage/telemetry-pref';
import { broadcastSettingChanged } from '../main-events';
import { readJsonImportFile } from '../utils/json-file';
import { applyLogLevel, logger } from '../utils/logger';
import { syncTitleBarOverlayFromTheme } from '../window-theme';
import type { IpcHandlerContext } from './wrap';

function isVerboseLogging(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { verbose?: unknown }).verbose === true
  );
}

/** settings 域 handler（模板版：无 API Key / 运行时模型 / 审批模式等业务项） */
export const settingsHandlers: InferHandlers<
  typeof IPC_DEFINITIONS,
  IpcHandlerContext
>['settings'] = {
  getAll: async () => {
    const settings = readAllSettings();
    if (settings['proxy'] !== undefined) {
      settings['proxy'] = await enrichProxySetting(settings['proxy']);
    }
    syncTitleBarOverlayFromTheme(settings['theme']);
    return { settings };
  },

  set: async (input) => {
    // 写透传 SQLite 后按键分发主进程侧副作用：主题（win32 overlay）、语言、代理
    // 代理值先拆出凭据存 keychain，再落无凭据 URL；广播派生状态供设置页回显
    if (input.key === 'proxy') {
      const sanitized = await sanitizeProxySetting(input.value);
      writeSetting('proxy', sanitized);
      await applyProxySetting(sanitized);
      broadcastSettingChanged('proxy', await enrichProxySetting(sanitized));
    } else {
      writeSetting(input.key, input.value);
      if (input.key === 'theme') {
        syncTitleBarOverlayFromTheme(input.value);
      }
      if (input.key === 'language') {
        setMainLanguage(input.value, app.getLocale());
      }
      if (input.key === 'logging') {
        applyLogLevel(isVerboseLogging(input.value));
      }
    }
    // 只记键名，不记值（值可能含代理凭据等敏感信息）
    logger.info({ key: input.key }, '设置已更新');
    return { ok: true };
  },

  exportSettings: async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.exportSettings'),
      defaultPath: join(app.getPath('documents'), `settings-export-${stamp}.json`),
      filters: [{ name: t('dialog.jsonFilter'), extensions: ['json'] }],
    });
    if (canceled || filePath === undefined || filePath === '') {
      return { saved: false };
    }
    try {
      await writeFile(filePath, JSON.stringify(buildSettingsExportFile()), 'utf8');
      logger.info({ filePath }, '设置导出完成');
      return { saved: true, path: filePath };
    } catch (error) {
      logger.error({ error: String(error) }, '设置导出失败');
      throw error;
    }
  },

  importSettings: async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: t('dialog.importSettings'),
      filters: [{ name: t('dialog.jsonFilter'), extensions: ['json'] }],
      properties: ['openFile'],
    });
    const filePath = filePaths[0];
    if (canceled || filePath === undefined) {
      return { imported: 0, skipped: 0 };
    }
    const payload = await readJsonImportFile(filePath);
    // 先校验（不落库），再把代理凭据拆到 keychain，避免明文写进 app_settings
    const preview = validateSettingsImport(payload);
    const proxyEntry = preview.applied.find((entry) => entry.key === 'proxy');
    const importPayload =
      proxyEntry === undefined
        ? payload
        : replaceSettingInImportPayload(
            payload,
            'proxy',
            await sanitizeProxySetting(proxyEntry.value),
          );
    const outcome = applySettingsImport(importPayload);
    for (const { key, value } of outcome.applied) {
      if (key === 'theme') {
        syncTitleBarOverlayFromTheme(value);
      }
      if (key === 'language') {
        setMainLanguage(value, app.getLocale());
      }
      if (key === 'logging') {
        applyLogLevel(isVerboseLogging(value));
      }
      if (key === 'proxy') {
        await applyProxySetting(value);
        broadcastSettingChanged('proxy', await enrichProxySetting(value));
        continue;
      }
      broadcastSettingChanged(key, value);
    }
    return { imported: outcome.imported, skipped: outcome.skipped };
  },

  resetAll: async () => {
    // 按白名单键清空（app_settings 表内其他键如 draft 不动），并重放副作用到默认态
    await clearProxyAuthCredentials();
    deleteSettings(SETTING_KEYS);
    syncTitleBarOverlayFromTheme(undefined);
    setMainLanguage(undefined, app.getLocale());
    applyLogLevel(false);
    await applyProxySetting(undefined);
    logger.info({}, '设置已全部恢复默认（app_settings 设置键已清空）');
    return { settings: {} };
  },

  getTelemetryLevel: async () => {
    const level = readTelemetryLevelSync();
    return { level };
  },

  setTelemetryLevel: async (input) => {
    await writeTelemetryLevel(input.level);
    logger.info({ level: input.level }, '遥测级别已更新（重启生效）');
    return { ok: true, level: input.level };
  },
};
