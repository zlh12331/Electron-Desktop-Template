// update-service.ts：自动更新编排——electron-updater 事件桥接为状态机快照 + 检查调度（启动延迟/
// 失败退避/长会话 12h）+ 下载取消 + win32 两段式安装（27/28 号）
// 边界：updater 实例全量注入（AutoUpdaterLike），本文件不直接 import electron-updater
import type {
  UpdateCheckRes,
  UpdateErrorKind,
  UpdateGetStatusRes,
  UpdateStatusPayload,
} from '@code-agent/shared/main';
import { DEFAULT_UPDATE_SETTINGS, IPC_DEFINITIONS } from '@code-agent/shared/main';
import { app, BrowserWindow } from 'electron';
import {
  clearDeferredInstall,
  isDeferredInstallPending,
  requestDeferredInstall,
  setCloseConfirmed,
} from '../../quit-state';
import { emitEvent } from '../../utils/emit-event';
import { reportError } from '../../utils/error-report';
import { logger } from '../../utils/logger';
import { withSpan } from '../telemetry/otel';
import {
  recordUpdateCheck,
  recordUpdateDownload,
  recordUpdateEvent,
  type UpdateCheckTrigger,
} from '../telemetry/otel-metrics';
import { pruneStaleDifferentialBaseline, resolveUpdaterCacheDir } from './update-cache';
import {
  classifyUpdateError,
  createUpdaterLogger,
  ensureBaselineConsistency,
  toReleaseNotes,
  type UpdaterLoggerLike,
} from './update-service-helpers';

// 启动检查延迟 5s（不与首屏抢资源）；失败按 1m/5m/15m 退避重试；长会话 12h 兜底再查；
// 单次检查 45s 超时（GitHub 网络卡死不能挂着调度链）
const LAUNCH_CHECK_DELAY_MS = 5_000;

const LAUNCH_CHECK_RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000];

const LONG_SESSION_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const CHECK_TIMEOUT_MS = 45_000;

export interface UpdateProgressInfo {
  readonly percent: number;
  readonly transferred: number;
  readonly total: number;
  readonly bytesPerSecond: number;
}

export interface CancellationTokenLike {
  cancel(): void;
  readonly cancelled: boolean;
}

type CheckTimerKind = 'launch' | 'retry' | 'long-session';

interface CheckAttempt {
  timedOut: boolean;
  settled: boolean;
  skipped: boolean;
  error: Error | null;
}

interface DownloadAttempt {
  readonly token: CancellationTokenLike;
  readonly startedAt: number;
  readonly version: string;
  settled: boolean;
  cancelled: boolean;
  failure: unknown;
}

export interface UpdateStartOptions {
  readonly autoCheckEnabled?: () => boolean;
  readonly autoDownloadEnabled?: () => boolean;
  readonly autoInstallOnAppQuitEnabled?: () => boolean;
  readonly allowPrereleaseEnabled?: () => boolean;
  readonly devUpdateEnabled?: boolean;
}

export interface AutoUpdaterLike {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(cancellationToken?: CancellationTokenLike): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  logger: UpdaterLoggerLike | null;
  forceDevUpdateConfig: boolean;
  on(event: 'checking-for-update', listener: () => void): void;
  on(event: 'update-available', listener: (info: UpdateInfoLike) => void): void;
  on(event: 'update-not-available', listener: () => void): void;
  on(event: 'download-progress', listener: (progress: UpdateProgressInfo) => void): void;
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): void;
  on(event: 'update-cancelled', listener: (info: UpdateInfoLike) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

interface UpdateInfoLike {
  readonly version: string;
  readonly releaseNotes?: unknown;
}

/** 更新服务契约（IPC handler 与托盘共同消费） */
// biome-ignore lint/style/useNamingConvention: I 前缀接口遵循项目惯例（IChatService 等）
export interface IUpdateService {
  start(options?: UpdateStartOptions): void;
  check(manual: boolean): Promise<UpdateCheckRes>;
  download(): { ok: boolean };
  cancelDownload(): void;
  getStatus(): UpdateGetStatusRes;
  onStatus(listener: (payload: UpdateStatusPayload) => void): () => void;
  quitAndInstall(): void;
  runDeferredInstall(): void;
  refreshAutoInstallOnAppQuit(): void;
  dispose(): void;
}

export class UpdateService implements IUpdateService {
  private snapshot: UpdateStatusPayload | null = null;

  private readonly statusListeners = new Set<(payload: UpdateStatusPayload) => void>();

  private lastCheckAt: number | null = null;

  private pendingVersion: string | null = null;

  private pendingReleaseNotes: string | null = null;

  private timer: NodeJS.Timeout | null = null;
  private timerKind: CheckTimerKind | null = null;

  private retryIndex = 0;

  private checkAttempt: CheckAttempt | null = null;
  private readonly expiredChecks = new WeakSet<Promise<unknown>>();

  private started = false;

  private downloadAttempt: DownloadAttempt | null = null;

  private devUpdateForced = false;

  private allowPrereleaseEnabled: (() => boolean) | null = null;

  private autoCheckEnabled: (() => boolean) | null = null;

  private autoDownloadEnabled: (() => boolean) | null = null;

  private autoInstallOnAppQuitEnabled: (() => boolean) | null = null;

  constructor(
    private readonly updater: AutoUpdaterLike,
    private readonly isPackaged: () => boolean,
    private readonly createCancellationToken: () => CancellationTokenLike,
  ) {}

  /** 启动调度：配 logger/自动下载关闭（用户显式确认后才下）/预发布开关；dev 或用户关闭时跳过 */
  start(options: UpdateStartOptions = {}): void {
    this.started = true;
    const autoCheckEnabled = (
      options.autoCheckEnabled ?? (() => DEFAULT_UPDATE_SETTINGS.autoCheck)
    )();
    this.devUpdateForced = options.devUpdateEnabled === true;
    this.allowPrereleaseEnabled = options.allowPrereleaseEnabled ?? null;
    this.autoCheckEnabled = options.autoCheckEnabled ?? null;
    this.autoDownloadEnabled = options.autoDownloadEnabled ?? null;
    this.autoInstallOnAppQuitEnabled = options.autoInstallOnAppQuitEnabled ?? null;

    this.updater.logger = createUpdaterLogger();
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = this.autoInstallOnAppQuitEnabled?.() ?? autoCheckEnabled;
    this.updater.forceDevUpdateConfig = this.devUpdateForced;

    this.registerListeners();

    if (!this.isPackaged() && !this.devUpdateForced) {
      logger.info({ scope: 'auto-updater' }, '开发模式：跳过启动检查调度（更新仅对打包版生效）');
      return;
    }
    if (!autoCheckEnabled) {
      logger.info({ scope: 'auto-updater' }, '用户已关闭自动检查更新：跳过启动检查调度');
      return;
    }
    logger.info({ scope: 'auto-updater' }, '已调度启动检查（延迟 5s）');
    this.schedule('launch', LAUNCH_CHECK_DELAY_MS);
  }

  /**
   * 检查更新（手动触发时错误才进快照，静默失败只留日志）
   *
   * 预发布通道：用户开了 allowPrerelease 或当前版本本身是预发布（预发布升级链不能断）
   */
  async check(manual: boolean): Promise<UpdateCheckRes> {
    return this.runCheck(manual ? 'manual' : 'launch');
  }

  private async runCheck(trigger: UpdateCheckTrigger, scheduled = false): Promise<UpdateCheckRes> {
    if (!this.isPackaged() && !this.devUpdateForced) {
      const message = '开发模式不支持自动更新（可用 APP_DEV_UPDATE=1 + dev-app-update.yml 调试）';
      if (trigger === 'manual') {
        this.emit({ phase: 'error', message }, false);
      }
      return { status: 'error', message };
    }
    if (this.checkAttempt?.settled === false) {
      return { status: 'checking' };
    }
    const startedAt = performance.now();
    const attempt: CheckAttempt = { timedOut: false, settled: false, skipped: false, error: null };
    this.checkAttempt = attempt;
    if (this.downloadAttempt?.settled) this.downloadAttempt = null;
    this.lastCheckAt = Date.now();
    let outcome: 'success' | 'error' = 'error';
    const fired = scheduled ? trigger : null;
    logger.info({ scope: 'auto-updater', trigger }, '开始检查更新');
    try {
      this.updater.allowPrerelease =
        (this.allowPrereleaseEnabled?.() ?? DEFAULT_UPDATE_SETTINGS.allowPrerelease) ||
        app.getVersion().includes('-');
      await withSpan('update.check', { trigger, 'app.version': app.getVersion() }, async () => {
        await this.withCheckTimeout(this.updater.checkForUpdates(), attempt);
        if (attempt.error !== null) {
          throw attempt.error;
        }
      });
      this.afterCheck(!attempt.skipped, fired);
      outcome = 'success';
      return { status: 'checking' };
    } catch (error) {
      const { message, errorKind } = describeCheckFailure(attempt.timedOut, error);
      logger.warn({ scope: 'auto-updater', errorKind }, `更新检查失败：${message}`);
      if (trigger === 'manual') {
        this.emit({ phase: 'error', errorKind, message });
      } else {
        recordUpdateEvent('error');
      }
      this.afterCheck(false, fired);
      return { status: 'error', message };
    } finally {
      attempt.settled = true;
      if (!attempt.skipped) recordUpdateCheck(trigger, outcome, performance.now() - startedAt);
    }
  }

  private async withCheckTimeout(
    checkPromise: Promise<unknown>,
    attempt: CheckAttempt,
  ): Promise<void> {
    // updater 可能复用超时后仍在途的 Promise，它不是第二次有效检查。
    if (this.expiredChecks.has(checkPromise)) {
      attempt.skipped = true;
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        checkPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            attempt.timedOut = true;
            this.expiredChecks.add(checkPromise);
            reject(new Error('check-timeout'));
          }, CHECK_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /** 手动下载已发现的版本（autoDownload 关闭时由设置页/通知触发） */
  download(): { ok: boolean } {
    if (this.pendingVersion === null) {
      return { ok: false };
    }
    if (this.downloadAttempt?.settled === false || this.snapshot?.phase === 'downloaded') {
      return { ok: true };
    }
    logger.info({ scope: 'auto-updater', version: this.pendingVersion }, '用户请求下载更新');
    this.beginDownload(this.pendingVersion);
    return { ok: true };
  }

  cancelDownload(): void {
    const attempt = this.downloadAttempt;
    if (attempt === null || attempt.settled || attempt.token.cancelled) return;
    logger.info({ scope: 'auto-updater' }, '取消更新下载');
    attempt.token.cancel();
  }

  getStatus(): UpdateGetStatusRes {
    return { snapshot: this.snapshot, lastCheckAt: this.lastCheckAt };
  }

  onStatus(listener: (payload: UpdateStatusPayload) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * win32 两段式安装：先置延迟安装标记 + 关窗协商放行 + 常规退出——
   * 退出善后链尾 runDeferredInstall 才真正拉安装器（防带进程写坏安装目录）
   * macOS/Linux 可直接 quitAndInstall
   */
  quitAndInstall(): void {
    logger.info(
      { scope: 'auto-updater', platform: process.platform, version: this.pendingVersion },
      '用户请求安装更新',
    );
    if (process.platform === 'win32') {
      requestDeferredInstall();
      setCloseConfirmed();
      app.quit();
      return;
    }
    this.updater.quitAndInstall(true, true);
  }

  /** 退出善后链尾调用：消费延迟安装标记，拉起安装向导（不重启应用） */
  runDeferredInstall(): void {
    if (!isDeferredInstallPending()) {
      return;
    }
    clearDeferredInstall();
    logger.info({ scope: 'auto-updater' }, '应用已退出，拉起安装向导');
    this.updater.quitAndInstall(false, false);
  }

  /** 退出前刷新「退出时自动安装」开关（用户可能在运行中改过设置，按最新值执行） */
  refreshAutoInstallOnAppQuit(): void {
    this.updater.autoInstallOnAppQuit =
      this.autoInstallOnAppQuitEnabled?.() ??
      this.autoCheckEnabled?.() ??
      DEFAULT_UPDATE_SETTINGS.autoInstallOnAppQuit;
  }

  dispose(): void {
    this.started = false;
    this.clearTimer();
    this.pendingVersion = null;
    this.pendingReleaseNotes = null;
    if (this.downloadAttempt !== null) {
      this.downloadAttempt.settled = true;
      this.downloadAttempt = null;
    }
    this.statusListeners.clear();
  }

  private registerListeners(): void {
    this.updater.on('checking-for-update', () => {
      if (this.acceptCheckEvent()) this.emit({ phase: 'checking' });
    });
    this.updater.on('update-available', (info) => {
      if (!this.acceptCheckEvent() || this.downloadAttempt?.settled === false) return;
      logger.info({ scope: 'auto-updater', version: info.version }, '发现新版本');
      this.pendingVersion = info.version;
      this.pendingReleaseNotes = toReleaseNotes(info.releaseNotes);
      if (this.autoDownloadEnabled?.() ?? DEFAULT_UPDATE_SETTINGS.autoDownload) {
        this.beginDownload(info.version);
      } else {
        this.emit({
          phase: 'available',
          version: info.version,
          ...(this.pendingReleaseNotes !== null ? { releaseNotes: this.pendingReleaseNotes } : {}),
        });
      }
    });
    this.updater.on('update-not-available', () => {
      if (!this.acceptCheckEvent()) return;
      logger.info({ scope: 'auto-updater' }, '当前已是最新版本');
      this.emit({ phase: 'not-available' });
    });
    this.updater.on('download-progress', (progress) => {
      if (this.downloadAttempt?.settled !== true) this.emitProgress(progress);
    });
    this.updater.on('update-downloaded', (info) => {
      const attempt = this.downloadAttempt;
      if (attempt === null || attempt.settled || attempt.version !== info.version) return;
      this.pendingReleaseNotes = toReleaseNotes(info.releaseNotes) ?? this.pendingReleaseNotes;
      this.finishDownload(attempt, 'downloaded');
    });
    this.updater.on('update-cancelled', (info) => {
      const attempt = this.downloadAttempt;
      if (attempt !== null && attempt.version === info.version) {
        this.finishDownload(attempt, 'cancelled');
      }
    });
    this.updater.on('error', (error) => {
      if (this.downloadAttempt !== null) {
        this.finishDownload(this.downloadAttempt, 'error', error);
      } else if (this.acceptCheckEvent()) {
        if (this.checkAttempt !== null) {
          this.checkAttempt.error ??= error;
        } else {
          this.emit({
            phase: 'error',
            errorKind: classifyUpdateError(error),
            message: error.message,
          });
        }
      }
    });
  }

  private acceptCheckEvent(): boolean {
    // 当前尝试已结束/已超时后，迟到事件不得改写结果或触发下载。
    // 不能用计时器计数器做全局阻断：底层 Promise 可能永不 settle，一次网络黑洞
    // 会把后续所有检查的事件永久拒掉。新尝试会替换 checkAttempt，重新获得处理资格。
    return (
      this.checkAttempt === null || (!this.checkAttempt.settled && !this.checkAttempt.timedOut)
    );
  }

  private beginDownload(version: string): void {
    const token = this.createCancellationToken();
    const attempt: DownloadAttempt = {
      token,
      version,
      startedAt: performance.now(),
      settled: false,
      cancelled: false,
      failure: null,
    };
    this.downloadAttempt = attempt;
    this.emit({
      phase: 'available',
      version,
      ...(this.pendingReleaseNotes !== null ? { releaseNotes: this.pendingReleaseNotes } : {}),
    });
    void withSpan('update.download', { 'app.version': app.getVersion() }, async () => {
      try {
        await this.ensureDifferentialBaseline();
        if (attempt.settled || token.cancelled) return;
        await this.updater.downloadUpdate(token);
        if (attempt.failure !== null) throw attempt.failure;
      } catch (error) {
        // 在下载 span 结束前上报，事件与 Promise 共用终态防止重复捕获。
        if (!token.cancelled && !attempt.cancelled) {
          this.finishDownload(attempt, 'error', error);
          throw error;
        }
      }
    }).then(
      () => this.finishDownload(attempt, token.cancelled ? 'cancelled' : 'downloaded'),
      (error: unknown) => this.finishDownload(attempt, 'error', error),
    );
  }

  private async ensureDifferentialBaseline(): Promise<void> {
    const result = await ensureBaselineConsistency(
      () => this.resolveUpdateCacheDir(),
      pruneStaleDifferentialBaseline,
    );
    if (result === 'pruned') {
      logger.info(
        { scope: 'auto-updater' },
        '基准块图与基准安装包版本不一致，已剔除陈旧块图（改从 release 取匹配基准，避免差分失败回退全量）',
      );
    } else if (result === 'error') {
      logger.warn({ scope: 'auto-updater' }, '差分基线一致性检查失败，跳过');
    }
  }

  private async resolveUpdateCacheDir(): Promise<string | null> {
    const resourcesPath: unknown = process.resourcesPath;
    if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
      const fromPackaged = await resolveUpdaterCacheDir(resourcesPath);
      if (fromPackaged !== null) {
        return fromPackaged;
      }
    }
    return await resolveUpdaterCacheDir(app.getAppPath(), undefined, 'dev-app-update.yml');
  }

  private emitProgress(info: UpdateProgressInfo): void {
    const version = this.pendingVersion;
    const percent = Math.round(info.percent);
    this.setTaskbarProgress(percent);
    this.emit({
      phase: 'downloading',
      progress: percent,
      transferred: info.transferred,
      total: info.total,
      bytesPerSecond: info.bytesPerSecond,
      ...(version !== null ? { version } : {}),
    });
  }

  private setTaskbarProgress(percent: number | null): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.setProgressBar(percent === null ? -1 : percent / 100);
      }
    }
  }

  private finishDownload(
    attempt: DownloadAttempt,
    outcome: 'downloaded' | 'cancelled' | 'error',
    error?: unknown,
  ): void {
    // 事件与 Promise 共用 attempt 终态，防重复漏斗和旧 Promise 清理新下载。
    if (attempt.settled || this.downloadAttempt !== attempt) return;
    const phase = attempt.token.cancelled ? 'cancelled' : outcome;
    attempt.settled = true;
    attempt.cancelled = phase === 'cancelled';
    recordUpdateDownload(phase, performance.now() - attempt.startedAt);
    this.setTaskbarProgress(null);
    if (phase === 'error') {
      attempt.failure = error ?? new Error('更新下载失败');
      const errorKind = classifyUpdateError(error);
      reportError(error, {
        message: '更新下载失败',
        tags: { scope: 'auto-updater', stage: 'download', errorKind },
      });
      this.emit({
        phase,
        errorKind,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    logger.info({ scope: 'auto-updater', phase }, '更新下载结束');
    const notes = this.pendingReleaseNotes;
    if (phase === 'cancelled') {
      this.pendingVersion = null;
      this.pendingReleaseNotes = null;
    }
    this.emit({
      phase,
      version: attempt.version,
      ...(phase === 'downloaded' && notes !== null ? { releaseNotes: notes } : {}),
    });
  }

  private emit(payload: UpdateStatusPayload, recordMetric = true): void {
    this.snapshot = payload;
    if (recordMetric && payload.phase !== 'downloading') {
      recordUpdateEvent(payload.phase);
    }
    for (const listener of this.statusListeners) {
      try {
        listener(payload);
      } catch (err) {
        logger.warn({ scope: 'auto-updater', error: String(err) }, '状态监听器执行失败');
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          emitEvent(win.webContents, IPC_DEFINITIONS.update.subscribeStatus, payload);
        }
      } catch (err) {
        logger.warn({ scope: 'auto-updater', error: String(err) }, '状态窗口广播失败');
      }
    }
  }

  private afterCheck(succeeded: boolean, fired: UpdateCheckTrigger | null): void {
    if (succeeded) {
      this.retryIndex = 0;
      if (this.timerKind === 'launch' || this.timerKind === 'retry') {
        this.clearTimer();
      }
      if (this.timerKind === null) {
        this.schedule('long-session', LONG_SESSION_CHECK_INTERVAL_MS);
      }
      return;
    }
    if (fired === 'long-session') {
      this.retryIndex = 0;
      this.schedule('long-session', LONG_SESSION_CHECK_INTERVAL_MS);
      return;
    }
    if (fired !== 'launch' && fired !== 'retry') {
      return;
    }
    const delay = LAUNCH_CHECK_RETRY_DELAYS_MS[this.retryIndex];
    if (delay === undefined) {
      logger.warn({ scope: 'auto-updater' }, '启动检查重试次数用尽，本会话不再自动检查');
      this.clearTimer();
      return;
    }
    this.retryIndex += 1;
    this.schedule('retry', delay);
  }

  private schedule(kind: CheckTimerKind, delayMs: number): void {
    this.clearTimer();
    this.timerKind = kind;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerKind = null;
      if (this.started) {
        void this.runCheck(kind, true);
      }
    }, delayMs);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timerKind = null;
  }
}

function describeCheckFailure(
  timedOut: boolean,
  error: unknown,
): { readonly message: string; readonly errorKind: UpdateErrorKind } {
  if (timedOut) {
    return {
      message: `更新检查超时（${Math.round(CHECK_TIMEOUT_MS / 1000)}s 未响应）`,
      errorKind: 'network',
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    errorKind: classifyUpdateError(error),
  };
}
