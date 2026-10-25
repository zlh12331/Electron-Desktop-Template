// menu.ts：生产版应用菜单安装——开发态保留 Electron 默认菜单（含 DevTools），
// 打包态替换为不含 View/Reload/DevTools 的最小菜单。边界：只装配菜单，不创建窗口。
import { app, Menu } from 'electron';
import { buildProductionMenuTemplate } from './menu-template';
import { logger } from './utils/logger';

/** 打包版安装最小菜单；开发态 no-op（保留默认 View/DevTools） */
export function installProductionMenu(): void {
  if (!app.isPackaged) {
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildProductionMenuTemplate()));
  logger.info({}, '生产版应用菜单已安装（无 View/DevTools）');
}
