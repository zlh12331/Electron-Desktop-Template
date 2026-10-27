// settings-defaults.ts：用户设置默认值单一真源（渲染层 store 与主进程消费方共用）。
// 这里只放平台无关的标量/对象默认值；快捷键默认依赖平台 MOD，仍在渲染层维护。
// 边界：不引入 zod / Electron，main / renderer 出口均可安全再导出。

/** 默认主题（与 settings.theme 值域一致） */
export const DEFAULT_THEME_SETTING = 'dark' as const;

/** 默认界面语言（与 settings.language 值域一致） */
export const DEFAULT_LANGUAGE_SETTING = 'zh-CN' as const;

/** 默认自动更新设置（settings.update） */
export const DEFAULT_UPDATE_SETTINGS = {
  autoCheck: true,
  allowPrerelease: false,
  skippedVersion: null,
} as const;

/** 默认窗口行为（settings.window） */
export const DEFAULT_WINDOW_SETTINGS = {
  closeAction: 'minimize',
  startMinimized: false,
} as const;

/** 默认通知设置（settings.notification） */
export const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: true,
} as const;

/** 默认网络代理设置（settings.proxy） */
export const DEFAULT_PROXY_SETTINGS = {
  mode: 'system',
} as const;

/** 默认日志设置（settings.logging） */
export const DEFAULT_LOGGING_SETTINGS = {
  verbose: false,
} as const;

/** 备份保留档位（settings.backup.keep；3 = 现状默认值） */
export const BACKUP_KEEP_OPTIONS = [3, 5, 10] as const;

/** 备份保留档位类型 */
export type BackupKeep = (typeof BACKUP_KEEP_OPTIONS)[number];

/** 默认备份设置（settings.backup） */
export const DEFAULT_BACKUP_SETTINGS = {
  autoBackup: true,
  keep: 3,
} as const;
