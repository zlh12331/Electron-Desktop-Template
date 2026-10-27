// backup-settings.ts：备份策略设置读取——启动备份与手动备份共用
// 单独成模块：db.ts 不能反向 import settings-pref（两者经由 getDb 已形成依赖方向）
import {
  BACKUP_KEEP_OPTIONS,
  type BackupKeep,
  DEFAULT_BACKUP_SETTINGS,
} from '@code-agent/shared/main';

import { logger } from '../../utils/logger';
import type { StartupBackupPolicy } from './db';
import { readSetting } from './settings-pref';

/** 读 backups 设置；缺失/损坏/读取失败均回落默认（自动备份开 + 保留 3 份） */
export function readBackupPolicy(): StartupBackupPolicy {
  try {
    const value = readSetting('backup');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ...DEFAULT_BACKUP_SETTINGS };
    }
    const autoBackup = (value as { autoBackup?: unknown }).autoBackup;
    const keep = (value as { keep?: unknown }).keep;
    return {
      autoBackup: typeof autoBackup === 'boolean' ? autoBackup : DEFAULT_BACKUP_SETTINGS.autoBackup,
      keep: (BACKUP_KEEP_OPTIONS as readonly number[]).includes(keep as number)
        ? (keep as BackupKeep)
        : DEFAULT_BACKUP_SETTINGS.keep,
    };
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      '读取备份策略失败，使用默认策略',
    );
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}
