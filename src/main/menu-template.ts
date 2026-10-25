import type { MenuItemConstructorOptions } from 'electron';

/**
 * 生产版最小应用菜单模板
 *
 * 只保留标准 File/Edit/Window（macOS 为 appMenu/Edit/Window）角色，
 * 刻意不包含 viewMenu——默认 View 菜单会暴露 Reload / Force Reload /
 * Toggle Developer Tools，进入 hash 路由后 Reload 还会保留残留 URL。
 *
 * 纯函数便于单测；开发模式仍使用 Electron 默认菜单（保留 DevTools）。
 *
 * @param platform 平台（测试可注入；默认 process.platform）
 * @returns Menu.buildFromTemplate 可直接消费的模板
 */
export function buildProductionMenuTemplate(
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  if (platform === 'darwin') {
    return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
  }
  return [{ role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
}
