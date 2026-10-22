// bridges.ts：渲染层 IPC 桥接的唯一挂载点——AppShell 只调 useAppBridges()
// 为什么集中在单个组合 hook 而不是遍历数组：React hooks 规则禁止在循环/条件里调用 hook，
// 每个桥接必须在顶层显式调用。把全部调用收敛到本文件，既满足规则，又让「新增一个桥接」
// 只需改本文件（加 import + 加一行调用），AppShell 不动。

import { useDeepLink } from '@/hooks/use-deep-link';
import { useInvalidationBridge } from '@/hooks/use-invalidation-bridge';
import { useProtocolCheck } from '@/hooks/use-protocol-check';
import { useSettingsBridge } from '@/hooks/use-settings-bridge';
import { useUpdateBridge } from '@/hooks/use-update-bridge';
import { useZoomEffect } from '@/hooks/use-zoom-effect';

/**
 * 挂载全部 IPC 桥接（主进程推送 → 客户端 store）。
 *
 * 模板版：缓存失效 / 更新 / 设置 / 深链 / 协议校验 / 缩放。
 * 接入业务时在此追加对应桥接（例：流式输出、终端输出流）。
 */
export function useAppBridges(): void {
  useInvalidationBridge();
  useUpdateBridge();
  useSettingsBridge();
  useDeepLink();
  useProtocolCheck();
  useZoomEffect();
}
