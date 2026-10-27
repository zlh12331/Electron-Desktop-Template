// app.handler.ts：app 域 IPC——就绪状态/构建信息/外链打开/数据目录/开机自启/退出/诊断包导出
import { join } from 'node:path';
import type { InferHandlers } from '@code-agent/shared/main';
import {
  AppError,
  ErrorCode,
  type IPC_DEFINITIONS,
  IPC_PROTOCOL_VERSION,
} from '@code-agent/shared/main';
import { app, dialog, shell } from 'electron';

import { takePendingDeepLink } from '../deep-link';
import { exportDiagnosticsPackage } from '../diagnostics';
import { readBuildInfo } from '../infra/app-info';
import {
  createAutostartDeps,
  readAutostartState,
  setAutostartEnabled,
} from '../infra/autostart/autostart';
import { t } from '../infra/i18n';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

export const appHandlers: InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['app'] = {
  getStatus: async () => {
    return { ready: true, protocolVersion: IPC_PROTOCOL_VERSION };
  },

  getInfo: async () => {
    const build = readBuildInfo();
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
      userDataPath: app.getPath('userData'),
      ...(build.channel !== undefined ? { channel: build.channel } : {}),
      ...(build.buildTime !== undefined ? { buildTime: build.buildTime } : {}),
      ...(build.commitSha !== undefined ? { commitSha: build.commitSha } : {}),
    };
  },

  openExternal: async (input) => {
    // 先解析再判协议：避免前缀匹配放过畸形串；file:/自定义 scheme 交系统关联程序处理，一律拒绝
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new AppError(ErrorCode.INVALID_INPUT, 'URL 格式非法');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new AppError(ErrorCode.INVALID_INPUT, '仅允许 http/https 协议');
    }
    await shell.openExternal(parsed.href);
    return { ok: true };
  },

  openDataDir: async () => {
    const dir = app.getPath('userData');
    const error = await shell.openPath(dir);
    return { ok: error.length === 0 };
  },

  openLogsDir: async () => {
    const dir = app.getPath('logs');
    const error = await shell.openPath(dir);
    return { ok: error.length === 0 };
  },

  takePendingDeepLink: async () => {
    return { payload: takePendingDeepLink() };
  },

  getLoginItemSettings: async () => {
    return await readAutostartState(createAutostartDeps());
  },

  setLoginItemSettings: async (input) => {
    return await setAutostartEnabled(createAutostartDeps(), input.openAtLogin);
  },

  quit: async () => {
    app.quit();
    return { ok: true };
  },

  // 诊断包：保存对话框选落点 → 打 zip（导出器在 ../diagnostics，内部已做敏感信息脱敏）
  exportDiagnostics: async () => {
    // 文件名时间戳剔除 :/（Windows 文件名非法字符）
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.exportDiagnostics'),
      defaultPath: join(app.getPath('documents'), `diagnostics-${stamp}.zip`),
      filters: [{ name: t('dialog.zipFilter'), extensions: ['zip'] }],
    });
    if (canceled || filePath === undefined || filePath === '') {
      return { saved: false };
    }
    try {
      const autostart = await readAutostartState(createAutostartDeps()).catch(() => null);
      await exportDiagnosticsPackage({
        filePath,
        userDataPath: app.getPath('userData'),
        logsPath: app.getPath('logs'),
        autostart,
      });
      logger.info({ filePath, autostart }, '诊断包导出完成');
      return { saved: true, path: filePath };
    } catch (error) {
      logger.error({ error: String(error), filePath }, '诊断包导出失败');
      throw error;
    }
  },
};
