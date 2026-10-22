export type MainLanguage = 'zh-CN' | 'en';

/** 主进程侧的用户可见文案（托盘菜单 / 系统对话框 / 启动失败提示） */
const ZH_CN: Readonly<Record<string, string>> = {
  'tray.checkUpdate': '检查更新',
  'tray.installUpdate': '重启并安装',
  'tray.downloading': '下载中',
  'tray.autostart': '开机自启',
  'tray.closeToTray': '关闭时最小化到托盘',
  'tray.quit': '退出',
  'tray.minimized': '已最小化到托盘，退出请用托盘菜单',
  'dialog.exportSettings': '导出设置',
  'dialog.importSettings': '导入设置',
  'dialog.exportDiagnostics': '导出诊断包',
  'dialog.jsonFilter': 'JSON',
  'dialog.zipFilter': 'ZIP 压缩包',
  'startup.failedTitle': '应用启动失败',
  'proxy.notApplicable': '当前非自定义代理模式（system/direct 无需测试）',
};

const EN: Readonly<Record<string, string>> = {
  'tray.checkUpdate': 'Check for updates',
  'tray.installUpdate': 'Restart & install',
  'tray.downloading': 'Downloading',
  'tray.autostart': 'Launch at login',
  'tray.closeToTray': 'Minimize to tray on close',
  'tray.quit': 'Quit',
  'tray.minimized': 'Minimized to tray. Quit from the tray menu',
  'dialog.exportSettings': 'Export settings',
  'dialog.importSettings': 'Import settings',
  'dialog.exportDiagnostics': 'Export diagnostics',
  'dialog.jsonFilter': 'JSON',
  'dialog.zipFilter': 'ZIP archive',
  'startup.failedTitle': 'Failed to start',
  'proxy.notApplicable': 'Not in custom proxy mode (system/direct needs no test)',
};

export const MAIN_DICTIONARIES: Readonly<Record<MainLanguage, Readonly<Record<string, string>>>> = {
  'zh-CN': ZH_CN,
  en: EN,
};
