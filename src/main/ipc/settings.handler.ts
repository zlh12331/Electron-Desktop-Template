// settings.handler.ts：settings 域 IPC——设置读写 + 副作用分发 + 遥测级别 + 设置导入导出/重置
// 注意：set 是「写穿透 + 按键分发副作用」模式，新增带主进程副作用的键必须在这里补分支
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type InferHandlers, type IPC_DEFINITIONS, SETTING_KEYS } from '@code-agent/shared/main';
import { app, dialog } from 'electron';

import { setMainLanguage, t } from '../infra/i18n';
import { applyProxyChange } from '../infra/network/proxy-applier';
import { applySettingsImport, buildSettingsExportFile } from '../infra/storage/settings-io';
import { deleteSettings, readAllSettings, writeSetting } from '../infra/storage/settings-pref';
import { readTelemetryLevelSync, writeTelemetryLevel } from '../infra/storage/telemetry-pref';
import { broadcastSettingChanged } from '../main-events';
import { readJsonImportFile } from '../utils/json-file';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from '../utils/wrap';
import { syncTitleBarOverlayFromTheme } from '../window-theme';

/** settings 域 handler（模板版：无 API Key / 运行时模型 / 审批模式等业务项） */
export const settingsHandlers: InferHandlers<
  typeof IPC_DEFINITIONS,
  IpcHandlerContext
>['settings'] = {
  getAll: async () => {
    const settings = readAllSettings();
    syncTitleBarOverlayFromTheme(settings['theme']);
    return { settings };
  },

  set: async (input) => {
    // 写透传 SQLite 后按键分发主进程侧副作用：主题（win32 overlay）、语言、代理
    // 渲染层自身的响应式刷新走 SETTINGS_EVENT_CHANGED 广播（settings-store 订阅）
    writeSetting(input.key, input.value);
    if (input.key === 'theme') {
      syncTitleBarOverlayFromTheme(input.value);
    }
    if (input.key === 'language') {
      setMainLanguage(input.value);
    }
    if (input.key === 'proxy') {
      await applyProxyChange(input.value);
    }
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
    const outcome = applySettingsImport(payload);
    for (const { key, value } of outcome.applied) {
      if (key === 'theme') {
        syncTitleBarOverlayFromTheme(value);
      }
      if (key === 'proxy') {
        await applyProxyChange(value);
      }
      broadcastSettingChanged(key, value);
    }
    return { imported: outcome.imported, skipped: outcome.skipped };
  },

  resetAll: async () => {
    // 按白名单键清空（app_settings 表内其他键如 draft 不动），并重放副作用到默认态
    deleteSettings(SETTING_KEYS);
    syncTitleBarOverlayFromTheme(undefined);
    await applyProxyChange(undefined);
    logger.info({}, '设置已全部恢复默认（app_settings 设置键已清空）');
    return { settings: {} };
  },

  getTelemetryLevel: async () => {
    const level = readTelemetryLevelSync();
    return { level };
  },

  setTelemetryLevel: async (input) => {
    await writeTelemetryLevel(input.level);
    return { ok: true, level: input.level };
  },
};
