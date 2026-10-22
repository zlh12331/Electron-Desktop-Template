// index.ts：应用入口与生命周期——单实例锁、whenReady 启动序列（遥测→DB→容器→IPC→窗口→托盘）、
// 深链接管、退出协商与善后链。边界：只做装配与编排，业务实现在 infra/ 与 service-container
import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, session } from 'electron';
import {
  broadcastDeepLink,
  extractProtocolUrl,
  parseDeepLink,
  registerDeepLinkProtocol,
} from './deep-link';
import { createAutostartDeps, setAutostartEnabled } from './infra/autostart/autostart';
import { initMainI18n, t } from './infra/i18n';
import { applyProxyChange } from './infra/network/proxy-applier';
import { initDb } from './infra/storage/db';
import { readAllSettings, readSetting, writeSetting } from './infra/storage/settings-pref';
import { readTelemetryLevelSync } from './infra/storage/telemetry-pref';
import { EventLoopLagMonitor } from './infra/telemetry/event-loop-lag';
import { reportEventLoopLag } from './infra/telemetry/lag-alert';
import { startMemoryMonitor } from './infra/telemetry/memory-monitor';
import { initTelemetry, shutdownTelemetry } from './infra/telemetry/otel';
import { clearUpdateCache, readUpdateCacheInfo } from './infra/update/update-cache';
import { appHandlers } from './ipc/app.handler';
import { backupHandlers } from './ipc/backup.handler';
import { devtoolsHandlers } from './ipc/devtools.handler';
import { dialogHandlers } from './ipc/dialog.handler';
import { createProxyHandlers } from './ipc/proxy.handler';
import { registerIpcHandlers } from './ipc/register';
import { secretsHandlers } from './ipc/secrets.handler';
import { settingsHandlers } from './ipc/settings.handler';
import { logsHandlers, systemHandlers } from './ipc/system.handler';
import { createUpdateHandlers } from './ipc/update.handler';
import { createWindowHandlers } from './ipc/window.handler';
import { broadcastLoginItemChanged, broadcastSettingChanged } from './main-events';
import { isQuitting, setCloseConfirmed, setQuitting } from './quit-state';
import { applyCspToSession } from './security/csp';
import { disposeServices, recoverFromCrash, serviceContainer } from './service-container';
import { createTray } from './tray';
import { reportMessage } from './utils/error-report';
import { flushPendingLogs, initLogger, logger, registerGlobalErrorHandlers } from './utils/logger';
import { createWindow, readCloseAction } from './window';
import { bringMainWindowToFront } from './window-show';
import { syncTitleBarOverlayFromTheme } from './window-theme';

// ───── 启动前引导：dev 路径重定向 + .env 加载（必须在 whenReady 之前完成）─────

if (!app.isPackaged) {
  // dev 的 userData 重定向到仓库内目录：避免沙箱拦截 %APPDATA%，也便于整目录删除重置
  const userDataOverride = process.env['APP_USER_DATA'];
  app.setPath('userData', userDataOverride ?? join(__dirname, '../../.electron-user-data'));
  // dev 固定开 CDP 远程调试端口（E2E / 外部 DevTools 接入依赖）
  const debugPort = process.env['APP_DEBUG_PORT'] ?? '9222';
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
}

if (process.env['NODE_ENV'] !== 'test') {
  try {
    process.loadEnvFile(join(__dirname, '../../.env'));
  } catch {}
}

// ───── 单实例锁与协议深链接管 ─────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // 第二实例拉起时：聚焦主窗，并把第二实例 argv 里的深链转发给现有窗口
  app.on('second-instance', (_event, argv) => {
    bringMainWindowToFront(createWindow);
    const url = extractProtocolUrl(argv);
    if (url !== null) {
      broadcastDeepLink(parseDeepLink(url));
    }
  });
}

registerDeepLinkProtocol();
// 冷启动深链暂存：窗口未创建时收到 open-url / argv 深链，等启动序列建窗后补广播
let coldLaunchDeepLink: string | null = null;
app.on('open-url', (event, url) => {
  event.preventDefault();
  const win = BrowserWindow.getAllWindows()[0];
  if (win === undefined) {
    coldLaunchDeepLink = url;
  } else {
    broadcastDeepLink(parseDeepLink(url));
  }
});

// ───── whenReady 启动序列（顺序敏感：logger→遥测→DB→容器初始化→IPC→窗口→托盘）─────

app
  .whenReady()
  .then(() => {
    if (!gotTheLock) {
      // 未获锁实例在上方已发起 quit，这里兜底防止极端时序下重复初始化
      return;
    }
    initLogger();
    const otelTelemetryLevel = readTelemetryLevelSync();
    if (otelTelemetryLevel !== 'off') {
      initTelemetry();
    } else {
      logger.warn({}, '遥测已关闭（telemetry-pref.json: off），跳过 OpenTelemetry 初始化');
    }
    initDb();
    initMainI18n(readSetting('language'));
    void applyProxyChange(readSetting('proxy'));
    registerGlobalErrorHandlers();
    void recoverFromCrash();

    registerIpcHandlers({
      app: appHandlers,
      settings: settingsHandlers,
      proxy: createProxyHandlers(),
      window: createWindowHandlers(),
      backup: backupHandlers,
      system: systemHandlers,
      logs: logsHandlers,
      devtools: devtoolsHandlers,
      dialog: dialogHandlers,
      secrets: secretsHandlers,
      update: createUpdateHandlers({
        updateService: serviceContainer.getUpdateService(),
        readCacheInfo: () => readUpdateCacheInfo(process.resourcesPath),
        clearCache: () => clearUpdateCache(process.resourcesPath),
      }),
    });

    serviceContainer.getUpdateService().start({
      autoCheckEnabled: isAutoCheckEnabled,
      allowPrereleaseEnabled: isAllowPrereleaseEnabled,
      devUpdateEnabled: process.env['APP_DEV_UPDATE'] === '1',
    });

    applyCspToSession(session.defaultSession, !app.isPackaged);
    logger.info({ isPackaged: app.isPackaged }, 'CSP 策略已注入');

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      // 白名单式收口：渲染层对系统权限（通知/摄像头/地理位置等）的请求一律拒绝
      logger.warn(
        { permission, url: webContents.getURL() },
        '拒绝渲染层权限请求（未授权权限类型）',
      );
      callback(false);
    });

    logger.info({}, '应用启动');

    stopMemoryMonitor = startMemoryMonitor({
      onAlert: (report) => {
        reportMessage(
          `主进程内存疑似持续增长：${report.growthMb.toFixed(0)}MB / ${report.durationSec.toFixed(0)}s`,
          'warning',
        );
        logger.warn(
          { growthMb: report.growthMb, durationSec: report.durationSec },
          '主进程内存疑似泄漏（连续增长）',
        );
      },
    });

    lagMonitor = new EventLoopLagMonitor({
      onLag: (sample) => reportEventLoopLag(sample, () => false),
    });
    lagMonitor.start();

    // Windows/Linux 无 open-url 事件：冷启动深链从 argv 补提（macOS 走 open-url 暂存）
    coldLaunchDeepLink ??= extractProtocolUrl(process.argv);

    createWindow();

    createTray({
      getUpdateStatus: () => serviceContainer.getUpdateService().getStatus().snapshot,
      checkForUpdate: () => {
        void serviceContainer.getUpdateService().check(false);
      },
      installUpdate: () => {
        serviceContainer.getUpdateService().quitAndInstall();
      },
      setAutostart: (enabled) => {
        void setAutostartEnabled(createAutostartDeps(), enabled)
          .then((state) => {
            broadcastLoginItemChanged(state);
          })
          .catch((err: unknown) => {
            logger.warn({ error: String(err) }, '托盘切换开机自启失败');
          });
      },
      getCloseAction: () => readCloseAction(),
      setCloseAction: (action) => {
        const next = { ...readWindowSettings(), closeAction: action };
        writeSetting('window', next);
        logger.info({ closeAction: action }, '托盘切换关窗行为');
        broadcastSettingChanged('window', next);
      },
      onUpdateStatus: (listener) => serviceContainer.getUpdateService().onStatus(listener),
    });

    // 补广播冷启动暂存的深链（必须在 createWindow 之后，渲染层已挂好监听）
    if (coldLaunchDeepLink !== null) {
      broadcastDeepLink(parseDeepLink(coldLaunchDeepLink));
      coldLaunchDeepLink = null;
    }

    nativeTheme.on('updated', () => {
      syncTitleBarOverlayFromTheme(readAllSettings()['theme']);
    });

    app.on('activate', () => {
      bringMainWindowToFront(createWindow);
    });
  })
  .catch((err: unknown) => {
    // biome-ignore lint/suspicious/noConsole: logger 在 whenReady 内才初始化，此处仅 console 兜底
    console.error('[FATAL] 应用启动失败：', err);
    try {
      const { dialog } = require('electron');
      dialog.showErrorBox(t('startup.failedTitle'), String(err));
    } catch {}
    app.exit(1);
  });

// ───── 退出链：window-all-closed / POSIX 信号 / before-quit 协商与善后 ─────

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // 终端 Ctrl-C / kill 不走关窗守卫，标记为已确认
    setCloseConfirmed();
    app.quit();
  });
}

let lagMonitor: EventLoopLagMonitor | null = null; // 启动期监控句柄，退出时停止
let stopMemoryMonitor: (() => void) | null = null;
app.on('before-quit', async (event) => {
  // 模板没有「退出会中断的长任务」，故不做退出协商，直接进善后链。
  // 接入长任务后在此加协商：event.preventDefault() → 弹确认 → setCloseConfirmed() → app.quit()。
  if (isQuitting()) {
    return;
  }
  event.preventDefault();
  setQuitting();
  try {
    serviceContainer.getUpdateService().refreshAutoInstallOnAppQuit();
    lagMonitor?.stop();
    lagMonitor = null;
    stopMemoryMonitor?.();
    stopMemoryMonitor = null;
    await disposeServices();
    await shutdownTelemetry();
  } catch (err) {
    logger.error({ error: err }, '应用退出清理失败');
  }
  // 善后链尾才是 quitAndInstall 的安全时机（此刻服务已停）
  serviceContainer.getUpdateService().runDeferredInstall();
  await flushPendingLogs();
  app.exit(0);
});

// ───── 设置读取容错包装（托盘/更新装配用；损坏或缺失回落默认值，不阻塞启动）─────

function readWindowSettings(): Record<string, unknown> {
  try {
    const value = readSetting('window');
    if (typeof value !== 'object' || value === null) {
      return {};
    }
    return { ...(value as Record<string, unknown>) };
  } catch {
    return {};
  }
}

function isAutoCheckEnabled(): boolean {
  try {
    const value = readSetting('update');
    if (typeof value !== 'object' || value === null) {
      return true;
    }
    return (value as { autoCheck?: unknown }).autoCheck !== false;
  } catch {
    return true;
  }
}

function isAllowPrereleaseEnabled(): boolean {
  try {
    const value = readSetting('update');
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    return (value as { allowPrerelease?: unknown }).allowPrerelease === true;
  } catch {
    return false;
  }
}
