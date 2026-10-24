// domains/index.ts：IPC 定义域册——新增/删除一个 IPC 域的唯一登记点
// 为什么是册而不是自动扫描：IPC 契约必须在编译期可推导（InferHandlers 依域键生成 handler
// 形状）。显式登记让「删掉一个域」= 删文件 + 删这里一行，漏删/漏登记在编译期暴露。
// 模板说明：当前仅保留通用底座能力；新增业务域时在本文件追加 import 与登记项。

import { appDomain } from './app';
import { backupDomain } from './backup';
import { devtoolsDomain } from './devtools';
import { dialogDomain } from './dialog';
import { invalidationDomain } from './invalidation';
import { logsDomain } from './logs';
import { proxyDomain } from './proxy';
import { secretsDomain } from './secrets';
import { settingsDomain } from './settings';
import { systemDomain } from './system';
import { telemetryDomain } from './telemetry';
import { updateDomain } from './update';
import { windowDomain } from './window';

/** 全部 IPC 域（模板版只含通用底座：应用/窗口/对话框/设置/系统/日志/开发工具/备份/更新/代理/凭据/缓存失效） */
export const IPC_DOMAINS = {
  app: appDomain,
  window: windowDomain,
  dialog: dialogDomain,
  settings: settingsDomain,
  system: systemDomain,
  logs: logsDomain,
  telemetry: telemetryDomain,
  devtools: devtoolsDomain,
  backup: backupDomain,
  update: updateDomain,
  proxy: proxyDomain,
  secrets: secretsDomain,
  invalidation: invalidationDomain,
} as const;
