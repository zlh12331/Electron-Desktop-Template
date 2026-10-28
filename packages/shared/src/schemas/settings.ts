// settings.ts：Settings 域 IPC 契约（zod 入参/响应 schema + 类型）的单一真源——
// 设置持久化键白名单、遥测级别、设置导出导入
// 边界：只定义形状与值域；落库（app_settings）/凭据（keychain）/代理、缩放等主进程应用点都在各自模块

import { z } from 'zod';
import { LANGUAGE_SETTINGS } from '../constants/language';
import { BACKUP_KEEP_OPTIONS, type BackupKeep } from '../constants/settings-defaults';
import { ZOOM_LEVELS } from '../constants/zoom';
import { TELEMETRY_LEVELS, type TelemetryLevel } from '../observability/telemetry-level';

// ── 渲染层设置下沉 SQLite（settings 持久化单一真源） ─────────────

/** settings:getAll 入参（无入参） */
export const SettingsGetAllReqSchema = z.object({});

/** settings:getAll 响应（key → JSON 值；渲染层设置按域分 key 存储） */
export const SettingsGetAllResSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

/** settings:resetAll 入参（无入参） */
export const SettingsResetAllReqSchema = z.object({});

/**
 * settings:resetAll 响应
 *
 * settings 恒为空对象：重置的实现语义是「删除 SETTING_KEYS 全部键」——
 * app_settings 回到新用户空表状态，缺失即默认（渲染层 applySettingsSnapshot({})
 * 全量回落 DEFAULT_SETTINGS；主进程各 readSetting 消费方均有 undefined→默认兜底）。
 * 不影响：keychain 凭据、历史数据、OS 登录项（开机自启）。
 */
export interface SettingsResetAllRes {
  readonly settings: Record<string, unknown>;
}

/** settings:resetAll 响应 zod schema（响应契约校验用） */
export const SettingsResetAllResSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

/**
 * settings:set 可写键白名单
 *
 * 渲染层 settings-store 的全部持久化分组（persistSetting 的 key 实参集合）。
 * 白名单外的一律拒绝——若 key 为自由字符串，渲染层可覆写主进程消费的任意
 * app_settings 键（如主进程内部配置组），且持久化后重启仍生效。
 * 本表同时是 settings:resetAll 的删除范围、设置导入的写入白名单，以及 SETTING_VALUE_SCHEMAS 的键集。
 */
export const SETTING_KEYS = [
  'theme',
  'language',
  'shortcuts',
  // 自动更新开关（settings.update：autoCheck 默认开、allowPrerelease 默认关；缺失/损坏按默认）
  'update',
  // 关窗行为（settings.window.closeAction；默认 minimize=最小化到托盘）
  'window',
  // 系统通知（settings.notification.enabled：最小化引导提示门控；缺失/损坏视为开）
  'notification',
  // 网络代理（settings.proxy：{mode, protocol?, host?, port?, bypass?}；主进程
  // proxy-applier 四路径收口应用——启动/settings:set/import/resetAll；缺失/损坏
  // 视为 system 直通；凭据单独存 keychain，不落本表）
  'proxy',
  // 界面缩放（settings.appearance：{zoom}；主进程 window:applyZoom 应用
  // webContents.setZoomFactor + Windows overlay 联动；缺失视为 1，损坏归最近档位）
  'appearance',
  // 详细日志（settings.logging：{verbose}；主进程 logger 应用 debug 级别）
  'logging',
  // 备份策略（settings.backup：{autoBackup, keep}；启动/手动备份共同消费）
  'backup',
] as const;

/** settings:set 可写键白名单 TypeScript 类型 */
export type SettingKey = (typeof SETTING_KEYS)[number];

/** 主题值域（与渲染层 Theme 对齐） */
const ThemeSettingSchema = z.enum(['light', 'dark', 'system']);

/** 界面语言值域（system = 跟随系统；其余为显式语言） */
const LanguageSettingSchema = z.enum(LANGUAGE_SETTINGS);

/** 单个快捷键字符串（录键控件写入；空串会让冲突检测失去意义） */
const ShortcutValueSchema = z.string().min(1).max(128);

/** shortcuts 域值：字段可选，读侧与默认值合并（兼容旧版只导出部分字段的文件） */
const ShortcutsSettingSchema = z.object({
  commandPalette: ShortcutValueSchema.optional(),
  toggleTheme: ShortcutValueSchema.optional(),
  openSettings: ShortcutValueSchema.optional(),
});

/** update 域值：字段可选，读侧与默认值合并 */
const UpdateSettingSchema = z.object({
  autoCheck: z.boolean().optional(),
  allowPrerelease: z.boolean().optional(),
  skippedVersion: z.string().min(1).nullable().optional(),
});

/** window 域值：字段可选，主进程读取时仍有默认值兜底 */
const WindowSettingSchema = z.object({
  closeAction: z.enum(['quit', 'minimize']).optional(),
});

/** notification 域值：字段可选，缺失按开启处理 */
const NotificationSettingSchema = z.object({
  enabled: z.boolean().optional(),
});

/** 代理模式值域 */
export const PROXY_MODES = ['system', 'direct', 'fixed'] as const;

/** 代理协议值域（SOCKS5 认证受 Chromium 限制，见 ProxySettingInputSchema） */
export const PROXY_PROTOCOLS = ['http', 'https', 'socks5'] as const;

/** 代理模式类型 */
export type ProxyMode = (typeof PROXY_MODES)[number];

/** 代理协议类型 */
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

/** 代理主机：域名 / IPv4 / IPv6，不含协议、端口、路径与凭据 */
const ProxyHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => !/[\s/?#@[\]]/.test(value), {
    message: 'proxy.host 不能包含空白、路径、方括号或凭据',
  })
  .refine(
    (value) =>
      /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value) || /^[0-9a-fA-F:]+$/.test(value),
    { message: 'proxy.host 必须是合法主机名或 IP 地址' },
  );

/** 代理端口 */
const ProxyPortSchema = z.number().int().min(1).max(65535);

/** 绕过项（域名后缀 / CIDR / <local>；不含空白） */
const ProxyBypassEntrySchema = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => !/\s/.test(value), { message: 'proxy.bypass 项不能包含空白字符' });

/** 代理认证（仅 HTTP/HTTPS；SOCKS5 认证 Chromium 不支持） */
const ProxyAuthSchema = z.object({
  username: z.string().max(256),
  password: z.string().max(1024),
});

/**
 * proxy 域值：fixed 模式必须给出协议/主机/端口；SOCKS5 不接受认证。
 *
 * auth 只允许出现在 settings:set / proxy:test 的入参里，主进程拆到 keychain 后
 * 落库值不含它；渲染层回显用派生字段 hasAuth / authUsername。
 */
export const ProxySettingInputSchema = z
  .object({
    mode: z.enum(PROXY_MODES),
    protocol: z.enum(PROXY_PROTOCOLS).optional(),
    host: ProxyHostSchema.optional(),
    port: ProxyPortSchema.optional(),
    bypass: z.array(ProxyBypassEntrySchema).max(64).optional(),
    auth: ProxyAuthSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== 'fixed') {
      return;
    }
    if (value.protocol === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['protocol'],
        message: 'proxy.mode=fixed 时 protocol 必填',
      });
    }
    if (value.host === undefined) {
      ctx.addIssue({ code: 'custom', path: ['host'], message: 'proxy.mode=fixed 时 host 必填' });
    }
    if (value.port === undefined) {
      ctx.addIssue({ code: 'custom', path: ['port'], message: 'proxy.mode=fixed 时 port 必填' });
    }
    if (value.protocol === 'socks5' && value.auth !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['auth'],
        message: 'SOCKS5 代理不支持认证（Electron/Chromium 限制）',
      });
    }
  });

/** proxy 落库值 schema（auth 由主进程 sanitize 后剥离） */
const ProxySettingSchema = ProxySettingInputSchema;

/** appearance 域值：zoom 必须是 ZOOM_LEVELS 的合法档位 */
const AppearanceSettingSchema = z.object({
  zoom: z.number().refine((value) => ZOOM_LEVELS.includes(value), {
    message: `appearance.zoom 必须是合法缩放档位（${ZOOM_LEVELS.join('/')}）`,
  }),
});

/** logging 域值：verbose 开启 debug 级文件日志 */
const LoggingSettingSchema = z.object({
  verbose: z.boolean().optional(),
});

/** 备份保留档位：只接受显式档位，避免用户写成 0/负数导致轮转异常 */
const BackupKeepSchema = z
  .number()
  .refine(
    (value): value is BackupKeep => (BACKUP_KEEP_OPTIONS as readonly number[]).includes(value),
    {
      message: `backup.keep 必须是合法档位（${BACKUP_KEEP_OPTIONS.join('/')}）`,
    },
  );

/** backup 域值：启动自动备份 + 保留份数 */
const BackupSettingSchema = z.object({
  autoBackup: z.boolean().optional(),
  keep: BackupKeepSchema.optional(),
});

/**
 * settings 各键的值级 schema（SETTING_KEYS 与 schema 一一对应，类型层面强制）
 *
 * 写边界（settings:set）与导入边界（settings:import）共用本表；读侧仍各自做默认值兜底。
 */
export const SETTING_VALUE_SCHEMAS: Readonly<Record<SettingKey, z.ZodType>> = {
  theme: ThemeSettingSchema,
  language: LanguageSettingSchema,
  shortcuts: ShortcutsSettingSchema,
  update: UpdateSettingSchema,
  window: WindowSettingSchema,
  notification: NotificationSettingSchema,
  proxy: ProxySettingSchema,
  appearance: AppearanceSettingSchema,
  logging: LoggingSettingSchema,
  backup: BackupSettingSchema,
};

/** settings:set 入参（写穿透：渲染层内存态变更后同步落库；值级 schema 与导入共用） */
export const SettingsSetReqSchema = z
  .object({
    key: z.enum(SETTING_KEYS),
    value: z.unknown(),
  })
  .superRefine((cfg, ctx) => {
    const parsed = SETTING_VALUE_SCHEMAS[cfg.key].safeParse(cfg.value);
    if (parsed.success) {
      return;
    }
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['value', ...issue.path],
        message: `${cfg.key}: ${issue.message}`,
      });
    }
  });

/** settings:set 响应 */
export const SettingsSetResSchema = z.object({
  ok: z.boolean(),
});

/** settings:event:changed 事件 payload（主进程写入后广播，渲染层据此回显） */
export const SettingsChangedPayloadSchema = z.object({
  key: z.enum(SETTING_KEYS),
  value: z.unknown(),
});

/** settings:event:changed 事件 payload 类型 */
export type SettingsChangedPayload = z.infer<typeof SettingsChangedPayloadSchema>;

// ─── 遥测级别 ───────────────────────────────────────────────

/** 遥测级别（off = 完全关闭；error-only = 仅错误；full = 全量） */
export const TelemetryLevelSchema = z.enum(TELEMETRY_LEVELS);

/** 遥测级别 TypeScript 类型（真源在 observability/telemetry-level） */
export type { TelemetryLevel };

/** settings:getTelemetryLevel 响应 payload */
export interface GetTelemetryLevelRes {
  readonly level: TelemetryLevel;
}

/** settings:getTelemetryLevel 响应 zod schema（响应契约校验用） */
export const GetTelemetryLevelResSchema = z.object({
  level: TelemetryLevelSchema,
});

/** settings:setTelemetryLevel 入参 zod schema */
export const SetTelemetryLevelReqSchema = z.object({
  level: TelemetryLevelSchema,
});

/** settings:setTelemetryLevel 响应 payload */
export interface SetTelemetryLevelRes {
  readonly ok: boolean;
  readonly level: TelemetryLevel;
}

/** settings:setTelemetryLevel 响应 zod schema（R4：响应契约校验） */
export const SetTelemetryLevelResSchema = z.object({
  ok: z.boolean(),
  level: TelemetryLevelSchema,
});

// ─── 设置导出/导入（app_settings 全表 JSON；keychain 凭据除外） ─────────

/**
 * 当前设置导出文件格式版本（导入侧仅接受本版本）
 *
 * 导出内容 = app_settings 表全量 key-value；API Key 等凭据存于系统 keychain
 * （safeStorage 加密，本机绑定不可迁移），不在导出文件内——这是显式安全取舍。
 */
export const SETTINGS_EXPORT_VERSION = 1;

/** 设置导出文件 schema（version=1；导入逐键过 SETTING_KEYS 白名单 + SETTING_VALUE_SCHEMAS 值校验后才写入） */
export const SettingsExportFileSchema = z.object({
  version: z.literal(SETTINGS_EXPORT_VERSION),
  /** 导出时刻（Unix timestamp 毫秒） */
  exportedAt: z.number().int(),
  settings: z.record(z.string(), z.unknown()),
});

/** 设置导出文件类型 */
export type SettingsExportFile = z.infer<typeof SettingsExportFileSchema>;

/** settings:export 响应 payload（saved/path） */
export interface SettingsExportRes {
  /** 是否已写出文件（用户在对话框取消时为 false） */
  readonly saved: boolean;
  /** 写出路径（仅 saved=true 时存在） */
  readonly path?: string;
}

/** settings:export 响应 zod schema（响应契约校验用） */
export const SettingsExportResSchema = z.object({
  saved: z.boolean(),
  path: z.string().optional(),
});

/**
 * settings:import 响应 payload
 *
 * imported = 通过白名单与值级校验并写入的键数；skipped = 白名单外被跳过的键数。
 * 白名单内任一值非法时整批拒绝（INVALID_INPUT），不会产生半截导入。
 */
export interface SettingsImportRes {
  /** 通过白名单与值级校验并写入的键数 */
  readonly imported: number;
  /** 白名单外被跳过的键数 */
  readonly skipped: number;
}

/** settings:import 响应 zod schema（响应契约校验用） */
export const SettingsImportResSchema = z.object({
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
