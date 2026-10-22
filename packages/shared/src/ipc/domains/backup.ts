// domains/backup.ts：backup 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../definitions.ts 聚合行 + ../domains/index.ts 登记

import type { BackupCreateRes, BackupListRes, BackupRestoreRes } from '../../schemas/backup';
import {
  BackupCreateResSchema,
  BackupListResSchema,
  BackupRestoreReqSchema,
  BackupRestoreResSchema,
} from '../../schemas/backup';
import { IPC_META } from '../meta';
import { withSchema } from '../with-schema';

export const backupDomain = {
  // 恢复点列表：无入参；每一项的健康度由主进程 quick_check 给出（不健康的恢复点会被 restore 拒绝）
  list: withSchema(IPC_META.backup.list, null, {} as BackupListRes, BackupListResSchema),
  // 立即备份：无入参；响应 name = 新备份文件名（与启动备份同处一个轮转环，超量删最旧）
  create: withSchema(IPC_META.backup.create, null, {} as BackupCreateRes, BackupCreateResSchema),
  // 恢复：name 必须是裸文件名（路径穿越防御在主进程），暂存后由下次启动应用
  restore: withSchema(
    IPC_META.backup.restore,
    BackupRestoreReqSchema,
    {} as BackupRestoreRes,
    BackupRestoreResSchema,
  ),
} as const;
