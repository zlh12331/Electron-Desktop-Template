// domains/app.ts：app 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../definitions.ts 聚合行 + ../domains/index.ts 登记

import { z } from 'zod';
import type {
  AppInfoRes,
  DeepLinkPayload,
  ExportDiagnosticsRes,
  LoginItemChangedPayload,
  LoginItemSettingsRes,
} from '../../schemas/app';
import {
  AppInfoResSchema,
  AppStatusResSchema,
  DeepLinkPayloadSchema,
  ExportDiagnosticsResSchema,
  LoginItemChangedPayloadSchema,
  LoginItemSettingsResSchema,
  OkResSchema,
  SetLoginItemSettingsReqSchema,
} from '../../schemas/app';
import { IPC_META } from '../meta';
import { withPayload, withSchema } from '../with-schema';

export const appDomain = {
  getStatus: withSchema(
    IPC_META.app.getStatus,
    null,
    {} as { ready: boolean; protocolVersion: number },
    AppStatusResSchema,
  ),
  getInfo: withSchema(IPC_META.app.getInfo, null, {} as AppInfoRes, AppInfoResSchema),
  openExternal: withSchema(
    IPC_META.app.openExternal,
    z.object({ url: z.string().min(1, 'URL 不能为空') }),
    {} as { ok: boolean },
    OkResSchema,
  ),
  openDataDir: withSchema(IPC_META.app.openDataDir, null, {} as { ok: boolean }, OkResSchema),
  getLoginItemSettings: withSchema(
    IPC_META.app.getLoginItemSettings,
    null,
    {} as LoginItemSettingsRes,
    LoginItemSettingsResSchema,
  ),
  setLoginItemSettings: withSchema(
    IPC_META.app.setLoginItemSettings,
    SetLoginItemSettingsReqSchema,
    {} as LoginItemSettingsRes,
    LoginItemSettingsResSchema,
  ),
  quit: withSchema(IPC_META.app.quit, null, {} as { ok: boolean }, OkResSchema),
  // 无入参：主进程收集诊断信息并弹保存对话框；取消时响应为 saved=false（无 path）
  exportDiagnostics: withSchema(
    IPC_META.app.exportDiagnostics,
    null,
    {} as ExportDiagnosticsRes,
    ExportDiagnosticsResSchema,
  ),
  // 协议唤起事件（code-agent://）：主进程收到外链唤起后广播，payload 由渲染层消费
  subscribeDeepLink: withPayload(
    IPC_META.app.subscribeDeepLink,
    {} as DeepLinkPayload,
    DeepLinkPayloadSchema,
  ),
  // 开机自启变更事件：写入后广播真实回读值——托盘与设置页两个入口靠它互相回显
  subscribeLoginItemChanged: withPayload(
    IPC_META.app.subscribeLoginItemChanged,
    {} as LoginItemChangedPayload,
    LoginItemChangedPayloadSchema,
  ),
} as const;
