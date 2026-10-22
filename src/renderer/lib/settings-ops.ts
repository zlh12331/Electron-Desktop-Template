// settings-ops.ts：设置页通用操作的 IPC 桥接层（组件不直连 window.api）
// 边界：只做「无桥兜底 + unwrap」的薄封装；错误码解析与文案在 lib/ipc.ts 单一真源。
// 模板版只含通用操作（更新缓存 / 设置导入导出 / 数据目录 / 诊断包 / 开机自启 / 代理测试）；
// 接入业务后按域追加（例：模型管理、渠道配置）。
import type {
  ExportDiagnosticsRes,
  LoginItemChangedPayload,
  LoginItemSettingsRes,
  ProxyTestRes,
  SettingsExportRes,
  SettingsImportRes,
  UpdateCacheInfo,
} from '@code-agent/shared/renderer';

import { hasIpcBridge, unwrap } from '@/lib/ipc';

/**
 * 拉取更新缓存占用
 *
 * @throws Error 无桥（[NO_BRIDGE]）或 IPC 失败（调用方可 catch 静默）
 */
export async function getUpdateCacheInfo(): Promise<UpdateCacheInfo> {
  if (!hasIpcBridge()) {
    throw new Error('[NO_BRIDGE] window.api unavailable');
  }
  return unwrap(await window.api.update.getCacheInfo());
}

/**
 * 清理更新缓存
 *
 * @throws Error 无桥（[NO_BRIDGE]）或 IPC 失败
 */
export async function clearUpdateCache(): Promise<UpdateCacheInfo> {
  if (!hasIpcBridge()) {
    throw new Error('[NO_BRIDGE] window.api unavailable');
  }
  return unwrap(await window.api.update.clearCache());
}

/**
 * 导出设置文件（主进程弹保存对话框）
 *
 * @returns 无桥时视为用户取消（saved: false）
 */
export async function exportSettingsFile(): Promise<SettingsExportRes> {
  if (!hasIpcBridge()) {
    return { saved: false };
  }
  return unwrap(await window.api.settings.exportSettings());
}

/**
 * 导入设置（主进程 dialog 选文件 + 白名单过滤 + 事务写入）
 *
 * @returns 无桥时返回零计数（调用方按取消分支静默处理）
 */
export async function importSettingsFile(): Promise<SettingsImportRes> {
  if (!hasIpcBridge()) {
    return { imported: 0, skipped: 0 };
  }
  return unwrap(await window.api.settings.importSettings());
}

/**
 * 恢复所有设置为默认（settings:resetAll）
 *
 * 调用前应先 flushPendingSettings()（stores/persistent/settings-store 导出）：
 * 在途写穿透若未落库，DELETE 后旧值会复活。响应 settings 恒为空对象——
 * 调用方据此 applySettingsSnapshot({}) 回落 DEFAULT_SETTINGS。
 *
 * @returns 重置后的设置快照（空对象；形状与 settings:getAll 响应一致）
 * @throws Error 无桥（[NO_BRIDGE]）或 IPC 失败
 */
export async function resetAllSettings(): Promise<Record<string, unknown>> {
  if (!hasIpcBridge()) {
    throw new Error('[NO_BRIDGE] window.api unavailable');
  }
  const res = unwrap<{ settings: Record<string, unknown> }>(await window.api.settings.resetAll({}));
  return res.settings;
}

/**
 * 打开用户数据目录（返回主进程回读结果，供调用方区分成功/失败提示）
 *
 * @throws Error 无桥（[NO_BRIDGE]）或 IPC 失败
 */
export async function openDataDirChecked(): Promise<{ ok: boolean }> {
  if (!hasIpcBridge()) {
    throw new Error('[NO_BRIDGE] window.api unavailable');
  }
  return unwrap(await window.api.app.openDataDir());
}

/**
 * 导出诊断包（构建/日志/系统信息）
 *
 * @returns 无桥时返回 null（调用方静默返回，不误报失败）
 */
export async function exportDiagnostics(): Promise<ExportDiagnosticsRes | null> {
  if (!hasIpcBridge()) {
    return null;
  }
  return unwrap(await window.api.app.exportDiagnostics());
}

/**
 * 读取开机自启状态（OS 登录项为唯一真源）
 *
 * @throws Error 无桥（[NO_BRIDGE]）或 IPC 失败（调用方可 catch 后隐藏开关）
 */
export async function getLoginItemSettings(): Promise<LoginItemSettingsRes> {
  if (!hasIpcBridge()) {
    throw new Error('[NO_BRIDGE] window.api unavailable');
  }
  return unwrap(await window.api.app.getLoginItemSettings());
}

/**
 * 设置开机自启（响应是写入后回读的真实 OS 状态）
 *
 * @returns 无桥时返回 null（静默不操作，不误报失败）
 */
export async function setLoginItemSettings(params: {
  readonly openAtLogin: boolean;
}): Promise<LoginItemSettingsRes | null> {
  if (!hasIpcBridge()) {
    return null;
  }
  return unwrap(await window.api.app.setLoginItemSettings(params));
}

/**
 * 订阅开机自启状态变更（托盘菜单改动 → 设置页回显）
 *
 * @returns unsubscribe；无桥时返回 no-op
 */
export function subscribeLoginItemChanged(
  handler: (payload: LoginItemChangedPayload) => void,
): () => void {
  if (!hasIpcBridge()) {
    return () => {};
  }
  return window.api.app.subscribeLoginItemChanged(handler);
}

/**
 * 测试代理连接（主进程经 proxiedFetch 探测轻量端点）
 *
 * @returns 无桥时返回不可测（浏览器模式 UI 可用，行为无感）
 */
export async function testProxyConnection(): Promise<ProxyTestRes> {
  if (!hasIpcBridge()) {
    return { ok: false, kind: 'not-applicable' };
  }
  return unwrap(await window.api.proxy.test({}));
}
