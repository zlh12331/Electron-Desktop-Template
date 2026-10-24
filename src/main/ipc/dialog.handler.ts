// dialog.handler.ts：dialog 域 IPC——目录/文件选择对话框；
// 仅 pickFiles 选中的文件登记读授权（目录选择不授予，避免放大到目录下全部文件）
import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';
import { dialog } from 'electron';

import { grantUserReadPaths } from '../infra/file/user-grants';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

export const dialogHandlers: InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['dialog'] = {
  pickDirectory: async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selectedPath = result.filePaths[0];
    if (selectedPath === undefined) {
      return { canceled: true };
    }

    logger.info({ count: 1 }, '用户选择目录');
    return { canceled: false, path: selectedPath };
  },

  pickFiles: async (input) => {
    const result = await dialog.showOpenDialog({
      properties: input.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    // 用户经系统对话框主动选中的文件自动加入读白名单（path-guard 的 user-grants 机制：
    // 用户亲自选择 = 授权，Agent 后续可直接读，不再重复弹审批）
    grantUserReadPaths(result.filePaths);
    logger.info({ count: result.filePaths.length }, '用户选择文件（已加入读授权）');

    return { canceled: false, paths: result.filePaths };
  },
};
