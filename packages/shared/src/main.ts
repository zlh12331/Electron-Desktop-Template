export * from './constants/brand';
export * from './constants/errors';
export * from './constants/protocol';
export * from './constants/zoom';
// ── IPC 契约：通道常量取自零 zod 的 ./ipc/channels（preload 可经 @code-agent/shared/ipc/channels
//    子路径直接取用）；定义表取自含 zod 的 ./ipc/definitions（主进程 handler 注册按它校验入参/响应）
export type { IpcChannel } from './ipc/channels';
export { IPC_CHANNELS } from './ipc/channels';
export type { IpcDefinitions } from './ipc/definitions';
export { IPC_DEFINITIONS, withPayload, withSchema } from './ipc/definitions';
export type {
  HandlerSignature,
  InferEventMap,
  InferHandlers,
  InferIpcApi,
  InferRequestMap,
} from './ipc/derive';

export type * from './ipc/payloads';
export type { IpcResponse } from './ipc/response';

// ── zod schema 值导出（单一真源，定义表由其组装）：主进程 IPC 入参/响应校验的运行时本体。
//    携带 zod 运行时：preload（sandbox）与渲染层应从各自专用出口取用——
//    @code-agent/shared/preload、@code-agent/shared/renderer
export * from './schemas/app';
export * from './schemas/backup';
export * from './schemas/devtools';
export * from './schemas/dialog';
export * from './schemas/invalidation';
export * from './schemas/proxy';
export * from './schemas/secrets';
export * from './schemas/settings';
export * from './schemas/system';
export * from './schemas/telemetry';
export * from './schemas/update';
export * from './schemas/window';
