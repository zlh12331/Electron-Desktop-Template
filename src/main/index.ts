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
import {
  createAutostartDeps,
  resolveStartHidden,
  setAutostartEnabled,
} from './infra/autostart/autostart';
import { initMainI18n, t } from './infra/i18n';
import { applyProxyChange } from './infra/network/proxy-applier';
import { initDb } from './infra/storage/db';
import { readAllSettings, readSetting, writeSetting } from './infra/storage/settings-pref';
import { readTelemetryLevelSync } from './infra/storage/telemetry-pref';
import { EventLoopLagMonitor } from './infra/telemetry/event-loop-lag';
import { reportEventLoopLag } from './infra/telemetry/lag-alert';
import { startMemoryMonitor } from './infra/telemetry/memory-monitor';
import { initTelemetry, shutdownTelemetry, withSpan } from './infra/telemetry/otel';
import { recordEventLoopDelay, recordMemoryGrowth } from './infra/telemetry/otel-metrics';
import { closeSentry, initSentry } from './infra/telemetry/sentry';
import {
  recordStartupMilestone,
  stopStartupObservation,
  withStartupObservation,
} from './infra/telemetry/startup';
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
import { telemetryHandlers } from './ipc/telemetry.handler';
import { createUpdateHandlers } from './ipc/update.handler';
import { createWindowHandlers } from './ipc/window.handler';
import { broadcastLoginItemChanged, broadcastSettingChanged } from './main-events';
import { isQuitting, setCloseConfirmed, setQuitting } from './quit-state';
import { applyCspToSession } from './security/csp';
import { disposeServices, recoverFromCrash, serviceContainer } from './service-container';
import { createTray } from './tray';
import { reportError, reportMessage } from './utils/error-report';
import { flushPendingLogs, initLogger, logger, registerGlobalErrorHandlers } from './utils/logger';
import { flushTelemetryOnFatal } from './utils/telemetry-flush';
import { createWindow, readCloseAction } from './window';
import { bringMainWindowToFront } from './window-show';
import { syncTitleBarOverlayFromTheme } from './window-theme';

// 环境文件必须先于 userData/CDP/Sentry 解析；空路径用于隔离验收，禁止继承本机后端配置。
const envFile = process.env['APP_ENV_FILE'];
if (process.env['NODE_ENV'] !== 'test' && envFile !== '') {
  try {
    process.loadEnvFile(envFile ?? join(__dirname, '../../.env'));
  } catch {}
}

if (!app.isPackaged) {
  // dev 的 userData 重定向到仓库内目录：避免沙箱拦截 %APPDATA%，也便于整目录删除重置
  const userDataOverride = process.env['APP_USER_DATA'];
  app.setPath('userData', userDataOverride ?? join(__dirname, '../../.electron-user-data'));
  // dev 固定开 CDP 远程调试端口（E2E / 外部 DevTools 接入依赖）
  const debugPort = process.env['APP_DEBUG_PORT'] ?? '9222';
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
}

// ───── 单实例锁与协议深链接管 ─────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // 第二实例拉起时：聚焦主窗，并把第二实例 argv 里的深链转发给现有窗口
  app.on('second-instance', (_event, argv) => {
    const url = extractProtocolUrl(argv);
    logger.info({ hasDeepLink: url !== null }, '第二实例拉起，聚焦主窗口');
    bringMainWindowToFront(createWindow);
    if (url !== null) {
      broadcastDeepLink(parseDeepLink(url));
    }
  });
}

const deepLinkRegistered = registerDeepLinkProtocol();

// performance.timeOrigin 对应 Node 进程时钟起点，包含模块加载时间，不冒充 OS 启动器耗时。
const startupStartedAt = 0;

// ───── 遥测前置：Sentry 必须在 app ready 前完成初始化（原生崩溃/早期异常才收得到）─────
// 遥测级别只读一次（userData 已在 dev 重定向之后确定）；off 时 initSentry 完整 no-op
const startupTelemetryLevel = readTelemetryLevelSync();
const sentryInit = gotTheLock
  ? initSentry(startupTelemetryLevel)
  : {
      enabled: false,
      initialized: false,
      reason: 'telemetry-off' as const,
      release: null,
      environment: null,
    };

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
  .then(async () => {
    if (!gotTheLock) {
      // 未获锁实例在上方已发起 quit，这里兜底防止极端时序下重复初始化
      return;
    }
    initLogger();
    // 协议注册发生在 whenReady 之前（OS 拉起入口要求），结果等 logger 就绪后统一记录
    if (deepLinkRegistered) {
      logger.info({}, '系统协议客户端已注册');
    } else {
      logger.warn({}, '系统协议客户端注册失败（深链入口不可用）');
    }
    if (sentryInit.enabled) {
      logger.info(
        { release: sentryInit.release, environment: sentryInit.environment },
        'Sentry 已启用（错误聚合 / 原生崩溃 / 会话健康）',
      );
    } else {
      logger.info({ reason: sentryInit.reason }, 'Sentry 未启用');
    }
    initTelemetry(startupTelemetryLevel);
    await withStartupObservation(
      startupStartedAt,
      resolveStartHidden(app) ? 'hidden' : 'foreground',
      async () => {
        await withSpan('db.init', {}, async () => {
          initDb();
        });
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
          telemetry: telemetryHandlers,
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
        recordStartupMilestone('services');

        stopMemoryMonitor = startMemoryMonitor({
          onAlert: (report) => {
            recordMemoryGrowth(report.growthMb, report.durationSec);
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
          onSample: (sample) => recordEventLoopDelay(sample.lagMs),
          onLag: (sample) => reportEventLoopLag(sample),
        });
        lagMonitor.start();

        // Windows/Linux 无 open-url 事件：冷启动深链从 argv 补提（macOS 走 open-url 暂存）
        coldLaunchDeepLink ??= extractProtocolUrl(process.argv);

        await withSpan('window.create', {}, async () => {
          createWindow();
        });
        const startupDurationMs = Math.round(performance.now() - startupStartedAt);
        recordStartupMilestone('window');
        logger.info({ durationMs: startupDurationMs }, '启动完成（主窗口已创建）');

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
          logger.debug({}, '应用激活，唤起主窗口');
          bringMainWindowToFront(createWindow);
        });
      },
    );
  })
  .catch(async (err: unknown) => {
    const forceExit = setTimeout(() => app.exit(1), 2_000);
    forceExit.unref();
    try {
      reportError(err, { message: '应用启动失败', tags: { scope: 'startup' } });
    } catch {}
    // biome-ignore lint/suspicious/noConsole: logger 在 whenReady 内才初始化，此处仅 console 兜底
    console.error('[FATAL] 应用启动失败：', err);
    try {
      const { dialog } = require('electron');
      dialog.showErrorBox(t('startup.failedTitle'), String(err));
    } catch {}
    await Promise.allSettled([flushPendingLogs(), flushTelemetryOnFatal(1_500)]);
    clearTimeout(forceExit);
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
  logger.info({}, '开始退出善后链');
  try {
    serviceContainer.getUpdateService().refreshAutoInstallOnAppQuit();
    lagMonitor?.stop();
    lagMonitor = null;
    stopMemoryMonitor?.();
    stopMemoryMonitor = null;
    await disposeServices();
    stopStartupObservation();
    await shutdownTelemetry();
    await closeSentry();
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
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      '读取窗口设置失败，托盘使用默认值',
    );
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
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      '读取更新设置失败，自动检查按默认开启',
    );
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
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      '读取预发布设置失败，默认不接收预发布',
    );
    return false;
  }
}
