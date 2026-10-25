// window.ts：主窗口创建与关窗协商——BrowserWindow 安全基线、导航/新窗限制、关窗行为（最小化到托盘 or 退出）、
// 渲染进程崩溃自愈。边界：窗口唤起在 window-show，标题栏配色在 window-theme
import { join } from 'node:path';
import { DEFAULT_WINDOW_SETTINGS } from '@code-agent/shared/main';
import { app, BrowserWindow, screen, shell } from 'electron';
import { installExtension, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { resolveStartHidden } from './infra/autostart/autostart';
import { readSetting } from './infra/storage/settings-pref';
import { loadWindowState, trackWindowState, type WindowState } from './infra/storage/window-state';
import { recordRendererCrash } from './infra/telemetry/otel-metrics';
import { bindStartupWindow, recordStartupReady } from './infra/telemetry/startup';
import { isCloseConfirmed, isQuitting } from './quit-state';
import { isAllowedRendererUrl, isHttpUrl, rendererEntryFileUrl } from './security/renderer-url';
import { notifyMinimizedToTray } from './tray';
import { reportError, reportMessage } from './utils/error-report';
import { logger } from './utils/logger';
import { markMaximizeOnNextShow } from './window-show';
import { TITLE_BAR_SYMBOL } from './window-theme';

/**
 * 读关窗行为设置（settings.window.closeAction）
 *
 * 损坏/缺失回落 'minimize'；导出供托盘「关闭时最小化到托盘」勾选项读同一真源（28 号 spec §6）
 */
export function readCloseAction(): 'minimize' | 'quit' {
  try {
    const value = readSetting('window');
    if (typeof value !== 'object' || value === null) {
      return DEFAULT_WINDOW_SETTINGS.closeAction;
    }
    return (value as { closeAction?: unknown }).closeAction === 'quit'
      ? 'quit'
      : DEFAULT_WINDOW_SETTINGS.closeAction;
  } catch {
    return DEFAULT_WINDOW_SETTINGS.closeAction;
  }
}

/**
 * 创建主窗口：恢复上次窗口状态 → frameless + 安全基线 → 导航/新窗限制 → 加载渲染层 →
 * 隐藏启动判定 → 关窗协商 → 崩溃自愈 → 状态跟踪 → dev DevTools
 */
export function createWindow(): BrowserWindow {
  const windowState: WindowState = loadWindowState(
    join(app.getPath('userData'), 'window-state.json'),
    { width: 1280, height: 800 },
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const win = new BrowserWindow({
    // 坐标条件展开：无保存值时交给 Electron 默认居中（exactOptionalPropertyTypes 要求）
    ...(windowState.x !== undefined ? { x: windowState.x } : {}),
    ...(windowState.y !== undefined ? { y: windowState.y } : {}),
    width: windowState.width,
    height: windowState.height,
    minWidth: 960,
    minHeight: 640,
    show: false, // 等 ready-to-show 再显示，避免白屏闪
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: TITLE_BAR_SYMBOL.dark,
            height: 52,
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // 安全基线：上下文隔离 + 关 Node 注入 + 沙箱 + webSecurity（preload 走 contextBridge）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // 导航白名单：只允许 dev server origin 或产物 index.html 的完全匹配，其余一律拦下
  // （配合主进程对 defaultSession 的 CSP/XFO 注入，构成三层外站拦截的第一层）
  const navRendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const rendererEntryUrl = rendererEntryFileUrl(app.getAppPath());
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url, rendererEntryUrl, navRendererUrl)) {
      logger.warn({ url: url.slice(0, 300) }, '已拦截非白名单页面导航');
      event.preventDefault();
    }
  });

  // window.open 一律拒绝：外链交系统浏览器打开，绝不在应用内开新 webContents
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      try {
        logger.info({ host: new URL(url).hostname }, '外部链接已交系统浏览器打开');
      } catch {}
      shell.openExternal(url);
    } else {
      logger.warn({ url: url.slice(0, 200) }, '已拦截非 http 外链打开请求');
    }
    return { action: 'deny' };
  });

  // 主框架加载失败（产物缺失 / dev server 未启动 / 文件损坏）：必须留下日志并进错误聚合
  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      reportError(new Error(`渲染层加载失败：${errorDescription}（${errorCode}）`), {
        message: '渲染层加载失败',
        fields: { errorCode, errorDescription, url: validatedUrl },
        tags: { scope: 'window', stage: 'load-fail' },
      });
    },
  );

  bindStartupWindow(win.webContents.id);
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  const startHidden = resolveStartHidden(app);
  if (startHidden) {
    logger.info({}, '开机自启静默启动：窗口驻留托盘不显示');
  }
  win.once('ready-to-show', () => {
    recordStartupReady(win.webContents.id, 'ready-to-show');
    if (startHidden) {
      return;
    }
    if (windowState.isMaximized) {
      win.maximize();
    }
    win.show();
  });

  win.on('close', (event) => {
    // 关窗协商：已确认退出 / 善后中 / E2E 豁免 → 放行；macOS 关窗语义是只关窗口（应用留存）
    // 非 macOS 按 closeAction 分流：minimize → 隐藏到托盘；quit → 继续关闭并由 before-quit 善后
    if (isQuitting() || isCloseConfirmed() || process.env['APP_SKIP_CLOSE_GUARD'] === '1') {
      return;
    }
    if (process.platform === 'darwin') {
      logger.info({}, 'macOS 关窗：关闭窗口（应用留存），不读 closeAction');
      return;
    }
    if (readCloseAction() === 'minimize') {
      event.preventDefault();
      logger.info({}, '关窗行为为最小化：隐藏窗口到托盘');
      notifyMinimizedToTray();
      win.hide();
    }
  });

  if (startHidden && windowState.isMaximized) {
    markMaximizeOnNextShow();
  }

  // 渲染进程崩溃自愈：60 秒窗口内最多自动 reload 2 次，反复崩溃停止（防 reload 风暴）
  let crashRecoveryCount = 0;
  let crashWindowStart = 0;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') {
      return;
    }
    reportError(
      new Error(`渲染进程异常退出：reason=${details.reason} exitCode=${details.exitCode}`),
      {
        message: '渲染进程异常退出，尝试自动恢复',
        fields: { exitCode: details.exitCode },
        tags: { scope: 'window', stage: 'renderer-crash', reason: details.reason },
      },
    );
    const now = Date.now();
    if (now - crashWindowStart > 60_000) {
      crashWindowStart = now;
      crashRecoveryCount = 0;
    }
    crashRecoveryCount += 1;
    recordRendererCrash(details.reason, crashRecoveryCount > 2 ? 'stopped' : 'reload');
    if (crashRecoveryCount > 2) {
      logger.error(
        { reason: details.reason, crashRecoveryCount },
        '渲染进程短时间反复崩溃，停止自动恢复（请手动重启应用）',
      );
      void reportMessage('渲染进程反复崩溃，已停止自动恢复', 'warning');
      return;
    }
    win.webContents.reload();
  });

  trackWindowState(win, join(app.getPath('userData'), 'window-state.json'));

  if (!app.isPackaged) {
    void installExtension(REACT_DEVELOPER_TOOLS)
      .then((name) => {
        logger.info({ name }, 'React DevTools 扩展已安装');
      })
      .catch((err: unknown) => {
        logger.warn(
          {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          },
          'React DevTools 扩展安装失败（不影响应用运行）',
        );
      });
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}
