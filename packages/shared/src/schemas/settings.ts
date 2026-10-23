// settings.ts：Settings 域 IPC 契约（zod 入参/响应 schema + 类型）的单一真源——
// 设置持久化键白名单、遥测级别、设置导出导入
// 边界：只定义形状与值域；落库（app_settings）/凭据（keychain）/代理、缩放等主进程应用点都在各自模块

import { z } from 'zod';
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
 * 本表同时是 settings:resetAll 的删除范围与设置导入的写入白名单。
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
  // 网络代理（settings.proxy：{mode, url?, bypass?}；主进程 proxy-applier 四路径
  // 收口应用——启动/settings:set/import/resetAll；缺失/损坏视为 system 直通）
  'proxy',
  // 界面缩放（settings.appearance：{zoom}；主进程 window:applyZoom 应用
  // webContents.setZoomFactor + Windows overlay 联动；缺失视为 1，损坏归最近档位）
  'appearance',
] as const;

/** settings:set 可写键白名单 TypeScript 类型 */
export type SettingKey = (typeof SETTING_KEYS)[number];

/** settings:set 入参（写穿透：渲染层内存态变更后同步落库） */
export const SettingsSetReqSchema = z
  .object({
    key: z.enum(SETTING_KEYS),
    value: z.unknown(),
  })
  .superRefine((cfg, ctx) => {
    // proxy 值级门禁：fixed 模式下 url 必须是合法 http(s) URL。本 schema 只覆盖
    // settings:set 通道；导入路径（applySettingsImport 白名单直写）不过本 schema，
    // 那里靠 resolver 的 fail-open 兜底——双防线，写拒在前保证无半生效状态。
    if (cfg.key !== 'proxy') {
      return;
    }
    const value = cfg.value as { mode?: unknown; url?: unknown } | null | undefined;
    if (value === null || value === undefined || typeof value !== 'object') {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'proxy 配置必须是非空对象（{mode, url?, bypass?}）',
      });
      return;
    }
    const validModes = ['system', 'direct', 'fixed'];
    if (!validModes.includes(value.mode as string)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `proxy.mode 仅支持 ${validModes.join('/')}`,
      });
      return;
    }
    if (value.mode === 'fixed') {
      let urlOk = false;
      if (typeof value.url === 'string' && value.url.length > 0) {
        try {
          const parsed = new URL(value.url);
          urlOk = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          urlOk = false;
        }
      }
      if (!urlOk) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message:
            'proxy.mode=fixed 时 url 必须是合法 http(s) 代理地址（如 http://127.0.0.1:7890）',
        });
      }
    }
  })
  .superRefine((cfg, ctx) => {
    // appearance 值级门禁：zoom 必须是合法档位（ZOOM_LEVELS 单一真源）。settings:set
    // 通道防御；导入路径不过本 schema，靠渲染层读侧 clampZoom 归一——双防线。
    if (cfg.key !== 'appearance') {
      return;
    }
    const value = cfg.value as { zoom?: unknown } | null | undefined;
    if (value === null || value === undefined || typeof value !== 'object') {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'appearance 配置必须是非空对象（{zoom}）',
      });
      return;
    }
    if (!ZOOM_LEVELS.includes(value.zoom as number)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `appearance.zoom 必须是合法缩放档位（${ZOOM_LEVELS.join('/')}）`,
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

/** 设置导出文件 schema（version=1；导入逐键过 SETTING_KEYS 白名单后才写入） */
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
 * imported = 通过白名单校验并写入的键数；skipped = 白名单外被跳过的键数。
 */
export interface SettingsImportRes {
  /** 通过白名单校验并写入的键数 */
  readonly imported: number;
  /** 白名单外被跳过的键数 */
  readonly skipped: number;
}

/** settings:import 响应 zod schema（响应契约校验用） */
export const SettingsImportResSchema = z.object({
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
