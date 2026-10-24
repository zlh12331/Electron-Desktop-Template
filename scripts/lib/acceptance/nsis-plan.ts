// scripts/lib/acceptance/nsis-plan.ts
// NSIS 生命周期的纯路径/参数层；运行时安装、启动、卸载在 nsis.ts。

import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/**
 * 校验 NSIS 相关路径不含空白
 *
 * NSIS 的 `/D=` 参数须位于命令行末尾且不保证带引号路径，空白路径在不同
 * electron-builder/NSIS 版本下行为不稳定，因此此处直接拒绝。
 *
 * @param value 待校验路径
 * @param label 错误信息中的名称
 * @throws Error 路径含空白时
 */
export function assertNoWhitespace(value: string, label: string): void {
  if (/\s/.test(value)) {
    throw new Error(`${label} 不能包含空白字符（NSIS /D 限制）：${value}`);
  }
}

/**
 * NSIS 静默安装参数（/D 必须是最后一个参数）
 *
 * @param installDir 目标安装目录（不能含空白）
 */
export function nsisInstallArgs(installDir: string): string[] {
  assertNoWhitespace(installDir, '安装目录');
  return ['/S', `/D=${installDir}`];
}

/**
 * 已安装的主可执行文件路径
 *
 * @param installDir 安装目录
 * @param productName 产品名
 */
export function installedExePath(installDir: string, productName: string): string {
  // NSIS 只跑 Windows；显式 win32.join，避免测试/门禁在 Linux runner 上得到混合分隔符
  return win32.join(installDir, `${productName}.exe`);
}

/**
 * 卸载器路径（electron-builder NSIS 默认命名）
 *
 * @param installDir 安装目录
 * @param productName 产品名
 */
export function uninstallerPath(installDir: string, productName: string): string {
  return win32.join(installDir, `Uninstall ${productName}.exe`);
}

/**
 * 校验安装包路径存在且为 .exe
 *
 * @param installerPath 安装包路径
 * @throws Error 文件不存在或扩展名不对时
 */
export function validateInstallerPath(installerPath: string): void {
  if (!installerPath.toLowerCase().endsWith('.exe')) {
    throw new Error(`NSIS 安装包必须是 .exe：${installerPath}`);
  }
  if (!existsSync(installerPath)) {
    throw new Error(`NSIS 安装包不存在：${installerPath}`);
  }
}
