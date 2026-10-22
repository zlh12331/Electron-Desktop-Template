// payloads.ts：IPC payload 类型层——两张 channel 类型映射，全部从 definitions.ts 的定义表派生
// 边界：不定义字段与运行时逻辑（字段语义以 packages/shared/src/schemas/ 下的 schema 为单一真源）；
// 映射从定义表整体推导，新增 channel 无需改本文件。

import type { IPC_DEFINITIONS } from './definitions';
import type { InferEventMap, InferRequestMap } from './derive';

/**
 * 请求-响应 channel 的类型映射：channel → { req, res }
 *
 * - req：渲染层 invoke 传出的入参形状，取 schema 的 z.input（默认值 / transform 应用前，
 *   与 ipcRenderer.invoke 实际发送的字节一致）
 * - res：主进程 handler 返回的响应类型
 *
 * 由 InferRequestMap 从 definitions.ts 的定义表整体推导：新增 channel 自动进入映射，无需在此手写。
 */
export type IpcRequestMap = InferRequestMap<typeof IPC_DEFINITIONS>;

/**
 * 事件 channel 的 payload 映射：channel → payload
 *
 * 事件由主进程主动推送（webContents.send），渲染层经 subscribe 被动接收；
 * 订阅返回 unsubscribe，组件卸载必须调用，否则监听器泄漏。
 *
 * 由 InferEventMap 从 definitions.ts 的定义表整体推导，新增 channel 无需在此手写。
 */
export type IpcEventMap = InferEventMap<typeof IPC_DEFINITIONS>;
