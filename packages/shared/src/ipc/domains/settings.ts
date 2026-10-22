// domains/settings.ts：settings 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../domains/index.ts 登记

import type {
  GetTelemetryLevelRes,
  SetTelemetryLevelRes,
  SettingsChangedPayload,
  SettingsResetAllRes,
} from '../../schemas/settings';
import {
  GetTelemetryLevelResSchema,
  SetTelemetryLevelReqSchema,
  SetTelemetryLevelResSchema,
  SettingsChangedPayloadSchema,
  SettingsExportResSchema,
  SettingsGetAllReqSchema,
  SettingsGetAllResSchema,
  SettingsImportResSchema,
  SettingsResetAllReqSchema,
  SettingsResetAllResSchema,
  SettingsSetReqSchema,
  SettingsSetResSchema,
} from '../../schemas/settings';
import { IPC_META } from '../meta';
import { withPayload, withSchema } from '../with-schema';

export const settingsDomain = {
  getAll: withSchema(
    IPC_META.settings.getAll,
    SettingsGetAllReqSchema,
    {} as { settings: Record<string, unknown> },
    SettingsGetAllResSchema,
  ),
  resetAll: withSchema(
    IPC_META.settings.resetAll,
    SettingsResetAllReqSchema,
    {} as SettingsResetAllRes,
    SettingsResetAllResSchema,
  ),
  set: withSchema(
    IPC_META.settings.set,
    SettingsSetReqSchema,
    {} as { ok: boolean },
    SettingsSetResSchema,
  ),
  getTelemetryLevel: withSchema(
    IPC_META.settings.getTelemetryLevel,
    null,
    {} as GetTelemetryLevelRes,
    GetTelemetryLevelResSchema,
  ),
  setTelemetryLevel: withSchema(
    IPC_META.settings.setTelemetryLevel,
    SetTelemetryLevelReqSchema,
    {} as SetTelemetryLevelRes,
    SetTelemetryLevelResSchema,
  ),
  exportSettings: withSchema(
    IPC_META.settings.exportSettings,
    null,
    {} as { saved: boolean; path?: string },
    SettingsExportResSchema,
  ),
  importSettings: withSchema(
    IPC_META.settings.importSettings,
    null,
    {} as { imported: number; skipped: number },
    SettingsImportResSchema,
  ),
  subscribeChanged: withPayload(
    IPC_META.settings.subscribeChanged,
    {} as SettingsChangedPayload,
    SettingsChangedPayloadSchema,
  ),
} as const;
