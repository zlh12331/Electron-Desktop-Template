// scripts/lib/acceptance/windows.ts
// Windows 运行态清理：协议注册、userData、进程树与等待器。仅在 win32 调用。

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * 协议注册表键（HKCU\Software\Classes\<protocol>）
 *
 * @param protocol URL 协议
 */
export function protocolRegistryKey(protocol: string): string {
  return `HKCU\\Software\\Classes\\${protocol}`;
}

/**
 * 查询注册表键是否存在
 *
 * @param key 完整注册表键
 */
export function registryKeyExists(key: string): boolean {
  return spawnSync('reg.exe', ['query', key], { stdio: 'ignore' }).status === 0;
}

/**
 * 删除注册表键（失败静默，调用方负责报告）
 *
 * @param key 完整注册表键
 */
export function deleteRegistryKey(key: string): void {
  spawnSync('reg.exe', ['delete', key, '/f'], { stdio: 'ignore' });
}

/**
 * 打包应用在 Windows 的 userData 目录（%APPDATA%\<executableName>）
 *
 * @param executableName 可执行名
 */
export function appDataDir(executableName: string): string {
  return join(process.env['APPDATA'] ?? '', executableName);
}

/**
 * electron-updater 在 Windows 的缓存目录（%LOCALAPPDATA%\<executableName>-updater）
 *
 * @param executableName 可执行名
 */
export function updaterCacheDir(executableName: string): string {
  return join(process.env['LOCALAPPDATA'] ?? '', `${executableName}-updater`);
}

/**
 * 强杀进程树（安装器/应用可能派生子进程）
 *
 * @param pid 主进程 PID
 */
export function killProcessTree(pid: number): void {
  spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
}

/**
 * 按映像名强杀进程（安装器 runAfterFinish 可能拉起应用，抢单实例锁）
 *
 * @param executableName 可执行名（不含 .exe）
 */
export function killProcessByName(executableName: string): void {
  spawnSync('taskkill', ['/F', '/IM', `${executableName}.exe`], { stdio: 'ignore' });
}

/**
 * 轮询等待条件成立
 *
 * @param condition 条件函数
 * @param timeoutMs 超时
 * @param intervalMs 轮询间隔
 * @returns 条件是否在超时前成立
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
  return condition();
}
