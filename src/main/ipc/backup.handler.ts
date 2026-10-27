// backup.handler.ts：backup 域 IPC——数据库备份列表/手动创建/恢复（恢复=暂存+重启生效）
import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';
import { app } from 'electron';
import { readBackupPolicy } from '../infra/storage/backup-settings';
import { listBackups, stageRestore } from '../infra/storage/backup-store';
import { createManualBackup, getDbPath } from '../infra/storage/db';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

/** 备份域 handler（无业务依赖：模板版没有运行中任务的前置校验） */
export const backupHandlers: InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['backup'] = {
  list: async () => {
    return { backups: listBackups(getDbPath()) };
  },

  create: async () => {
    const { name } = await createManualBackup(readBackupPolicy().keep);
    return { name };
  },

  restore: async (input) => {
    // 暂存替换 + relaunch：SQLite 文件被本进程持有，必须重启后由启动序列完成真替换
    stageRestore(getDbPath(), input.name);
    logger.warn({ backup: input.name }, '备份恢复已暂存，即将重启应用以生效');
    setImmediate(() => {
      app.relaunch();
      app.quit();
    });
    return { ok: true };
  },
};
