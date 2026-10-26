// scripts/lib/acceptance/nsis.ts
// NSIS 安装生命周期：静默安装到隔离目录 → 启动已安装应用 → 静默卸载 → 校验清理。
// 只在 Windows 执行，且会真实改动 HKCU（协议/卸载项）与 %APPDATA%；调用方必须显式确认。

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { _electron as electron } from 'playwright';

import { ACCEPTANCE_ENV_STRIP_KEYS, cleanEnv, runCommand } from './commands';
import {
  assertNoWhitespace,
  installedExePath,
  nsisInstallArgs,
  uninstallerPath,
  validateInstallerPath,
} from './nsis-plan';
import {
  appDataDir,
  deleteRegistryKey,
  killProcessByName,
  killProcessTree,
  protocolRegistryKey,
  registryKeyExists,
  updaterCacheDir,
  waitFor,
} from './windows';

/** 安装/卸载超时 */
const INSTALL_TIMEOUT_MS = 180_000;
/** 路径出现/消失的等待上限 */
const PATH_WAIT_MS = 30_000;
/** 卸载后主程序消失的等待上限 */
const UNINSTALL_WAIT_MS = 60_000;
/** 卸载后注册表清理的等待上限（NSIS 卸载器会复制自身后异步执行） */
const REGISTRY_WAIT_MS = 30_000;
/** 应用优雅关闭的等待上限 */
const APP_CLOSE_MS = 15_000;

/** NSIS 生命周期参数 */
export interface NsisLifecycleOptions {
  /** 待验证的 NSIS 安装包（绝对路径） */
  readonly installerPath: string;
  /** 产品名（决定安装目录内的 exe 与卸载器名） */
  readonly productName: string;
  /** 可执行名（决定 %APPDATA% 目录与进程名） */
  readonly executableName: string;
  /** 协议名（用于校验安装/卸载的注册表清理） */
  readonly protocol: string;
  /** 隔离工作目录（不能含空白） */
  readonly workDir: string;
  /** 保留安装/卸载现场（调试用） */
  readonly keep: boolean;
  /** 调用方已确认会安装/卸载真实应用 */
  readonly confirmed: boolean;
}

/** 等待 Electron 应用退出；优雅关闭失败则强杀进程树 */
async function closeElectron(app: ElectronApplication): Promise<void> {
  let child: ReturnType<ElectronApplication['process']> | undefined;
  try {
    child = app.process();
  } catch {
    child = undefined;
  }
  try {
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, APP_CLOSE_MS);
      }),
    ]);
  } catch {
    // 应用已退出/连接断开：由下方进程句柄兜底
  }
  if (child !== undefined && child.exitCode === null && !child.killed && child.pid !== undefined) {
    killProcessTree(child.pid);
    await waitFor(() => child.exitCode !== null, 10_000);
  }
}

/** 启动已安装应用，验证品牌与 preload 注入后关闭 */
async function verifyInstalledApp(executablePath: string, productName: string): Promise<void> {
  const app = await electron.launch({
    executablePath,
    env: { ...cleanEnv(process.env, ACCEPTANCE_ENV_STRIP_KEYS), ['NODE_ENV']: 'production' },
  });
  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const title = await page.title();
    if (!title.includes(productName)) {
      throw new Error(`已安装应用标题不含产品名：${title}`);
    }
    const apiType = await page.evaluate(() => typeof (window as Window & { api?: unknown }).api);
    if (apiType !== 'object') {
      throw new Error(`已安装应用 window.api 未注入（${apiType}）`);
    }
  } finally {
    await closeElectron(app);
  }
}

/** 检查安装目录与卸载器就绪，执行静默卸载并等待主程序消失 */
async function uninstallAndVerify(
  installDir: string,
  productName: string,
  workDir: string,
  protocolKey: string,
): Promise<void> {
  const exe = installedExePath(installDir, productName);
  const uninstaller = uninstallerPath(installDir, productName);
  if (!(await waitFor(() => existsSync(uninstaller), PATH_WAIT_MS))) {
    throw new Error(`未找到卸载器：${uninstaller}`);
  }
  runCommand(
    'NSIS 卸载',
    { command: uninstaller, args: ['/S'], cwd: workDir },
    {
      timeoutMs: INSTALL_TIMEOUT_MS,
    },
  );
  if (!(await waitFor(() => !existsSync(exe), UNINSTALL_WAIT_MS))) {
    throw new Error(`卸载后主程序仍存在：${exe}`);
  }
  // /S 返回时卸载可能尚未开始（installer.nsh 已注明），文件消失也不保证注册表已清理。
  if (!(await waitFor(() => !registryKeyExists(protocolKey), REGISTRY_WAIT_MS))) {
    throw new Error(`卸载后协议注册仍在：${protocolKey}`);
  }
}

/** 清理状态（只在本次运行创建时删除，避免误删用户既有数据） */
interface RuntimeCleanupState {
  readonly appData: string;
  readonly appDataExisted: boolean;
  readonly updaterCache: string;
  readonly updaterCacheExisted: boolean;
  readonly protocolKey: string;
}

/** 清理本次验收创建的 userData、updater 缓存与协议注册 */
function cleanupRuntime(state: RuntimeCleanupState): void {
  if (!state.appDataExisted && existsSync(state.appData)) {
    rmSync(state.appData, { recursive: true, force: true });
  }
  if (!state.updaterCacheExisted && existsSync(state.updaterCache)) {
    rmSync(state.updaterCache, { recursive: true, force: true });
  }
  if (registryKeyExists(state.protocolKey)) {
    deleteRegistryKey(state.protocolKey);
  }
}

/**
 * 执行一次完整的 NSIS 安装生命周期验证
 *
 * @param options 安装包、品牌、隔离目录与确认标记
 * @throws Error 平台不符、路径不安全、安装/启动/卸载/清理失败时
 */
export async function runNsisLifecycle(options: NsisLifecycleOptions): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('NSIS 生命周期仅支持 Windows');
  }
  if (!options.confirmed) {
    throw new Error('NSIS 生命周期会安装/卸载真实应用，必须显式确认');
  }
  validateInstallerPath(options.installerPath);
  assertNoWhitespace(options.workDir, '工作目录');
  const installDir = join(options.workDir, 'install');
  if (existsSync(installDir)) {
    throw new Error(`安装目录已存在，拒绝覆盖：${installDir}`);
  }
  const protocolKey = protocolRegistryKey(options.protocol);
  if (registryKeyExists(protocolKey)) {
    throw new Error(`协议已注册，拒绝覆盖：${protocolKey}`);
  }
  const appData = appDataDir(options.executableName);
  const appDataExisted = existsSync(appData);
  const updaterCache = updaterCacheDir(options.executableName);
  const updaterCacheExisted = existsSync(updaterCache);
  let succeeded = false;

  mkdirSync(options.workDir, { recursive: true });
  try {
    console.log(`[nsis] 静默安装 → ${installDir}`);
    runCommand(
      'NSIS 安装',
      {
        command: options.installerPath,
        args: nsisInstallArgs(installDir),
        cwd: options.workDir,
      },
      {
        timeoutMs: INSTALL_TIMEOUT_MS,
      },
    );
    const exe = installedExePath(installDir, options.productName);
    if (!(await waitFor(() => existsSync(exe), PATH_WAIT_MS))) {
      throw new Error(`安装后未找到可执行文件：${exe}`);
    }

    // 安装器 runAfterFinish 在部分 NSIS 配置下会拉起应用；Windows 进程名取 productName，
    // 不是 executableName。先结束它，避免单实例锁让 Playwright 连到已在运行的实例。
    killProcessByName(options.productName);
    await verifyInstalledApp(exe, options.productName);
    await uninstallAndVerify(installDir, options.productName, options.workDir, protocolKey);

    succeeded = true;
    console.log('[nsis] ✅ 安装 → 启动 → 卸载 完成');
  } finally {
    cleanupRuntime({ appData, appDataExisted, updaterCache, updaterCacheExisted, protocolKey });
    if (succeeded && !options.keep) {
      rmSync(options.workDir, { recursive: true, force: true });
    } else {
      console.log(`[nsis] 保留现场：${options.workDir}`);
    }
  }
}
