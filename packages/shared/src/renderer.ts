// renderer.ts：渲染层专用出口（@code-agent/shared/renderer）
// 边界：只再导出渲染层需要的常量 / 类型 / 少量值；schema 一律 type-only（编译期擦除，
// 不进渲染层打包图），需要值的地方逐条具名导出并在下方注明理由。

// 品牌常量（零依赖，由 app.config.json 生成）
export {
  APP_ID,
  APP_PROTOCOL,
  ARTIFACT_BASE_NAME,
  EXECUTABLE_NAME,
  PRODUCT_NAME,
  REPO_NAME,
  REPO_OWNER,
  STORAGE_PREFIX,
} from './constants/brand';
export type { ErrorMeta, IpcError } from './constants/errors';
export { ERROR_META, ErrorCode } from './constants/errors';
export { IPC_PROTOCOL_VERSION } from './constants/protocol';
export {
  DEFAULT_LANGUAGE_SETTING,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PROXY_SETTINGS,
  DEFAULT_THEME_SETTING,
  DEFAULT_UPDATE_SETTINGS,
  DEFAULT_WINDOW_SETTINGS,
} from './constants/settings-defaults';
export {
  clampZoom,
  DEFAULT_ZOOM,
  overlayHeightFor,
  stepZoom,
  ZOOM_LEVELS,
} from './constants/zoom';
export type { IpcApi } from './ipc/api';
export type { IpcChannel } from './ipc/channels';
export { IPC_CHANNELS } from './ipc/channels';
export type { IpcDefinitions } from './ipc/definitions';
export type * from './ipc/payloads';
export type { IpcEventMap, IpcRequestMap } from './ipc/payloads';
export type { IpcResponse } from './ipc/response';

// schemas 一律 type-only 重导出：`export type` 编译期擦除，对应 schema 模块不进渲染层打包图；
// 渲染层要用的值只有下面两处具名导出（失效域词表 / 设置键白名单）。
export type * from './schemas/app';
export type * from './schemas/backup';
export type * from './schemas/devtools';
export type * from './schemas/dialog';
export type * from './schemas/invalidation';
// 失效域词表：渲染层前缀失效映射须与主进程声明侧同源（禁散写字面量）
export { INVALIDATION_DOMAINS } from './schemas/invalidation';
// notes-example:start
export type * from './schemas/notes';
// notes-example:end
export type * from './schemas/proxy';
export type * from './schemas/secrets';
export type * from './schemas/settings';
export type { SettingKey } from './schemas/settings';
// settings:set 可写键白名单：渲染层侧用于启动时逐键过滤旧 localStorage 遗留设置再迁移落库
export { SETTING_KEYS } from './schemas/settings';
export type * from './schemas/system';
export type * from './schemas/telemetry';
export type * from './schemas/update';
export type * from './schemas/window';
