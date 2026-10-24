import { clampZoom, DEFAULT_ZOOM, type SettingKey } from '@code-agent/shared/renderer';
import { create } from 'zustand';

import { changeLanguage, LANGUAGE_STORAGE_KEY } from '@/i18n/config';
import { reportError } from '@/lib/error-report';
import { mirrorThemeForFirstPaint } from '@/lib/theme-init';

/**
 * 平台修饰键：macOS 用 Meta（⌘），Windows/Linux 用 Ctrl
 *
 * 默认快捷键按平台归一化（Windows 用户按 Ctrl+P 生效，与快捷键帮助文档一致）。
 */
const IS_MAC =
  typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac') === true;
const MOD = IS_MAC ? 'Meta' : 'Ctrl';

/**
 * 主题类型
 *
 * - 'light'：亮色
 * - 'dark'：暗色
 * - 'system'：跟随系统偏好
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * 主题循环顺序：dark → light → system → dark
 *
 * 所有切换入口（快捷键 / Topbar / 账户菜单 / 命令面板）共用同一循环，
 * 保证三态均可到达（此前快捷键为三态而 UI 为两态，system 无 UI 入口）。
 */
const THEME_CYCLE: Readonly<Record<Theme, Theme>> = {
  dark: 'light',
  light: 'system',
  system: 'dark',
};

/** 计算下一个主题（三态循环） */
export function nextTheme(theme: Theme): Theme {
  return THEME_CYCLE[theme];
}

/**
 * 快捷键配置（使用 KeyboardEvent.code 作为键名，便于跨键盘布局）
 */
export interface KeyboardShortcuts {
  /** 打开命令面板 */
  readonly commandPalette: string;
  /** 切换主题 */
  readonly toggleTheme: string;
  /** 打开设置 */
  readonly openSettings: string;
}

/**
 * 自动更新设置
 *
 * autoCheck 是"自动发现"总开关（默认开）：开启时每次启动自动检查、发现新版
 * 后台下载、退出时自动安装；关闭时三者全停，但用户手动点"检查更新"后的
 * 下载与安装照常（见 docs/history/27-auto-update-spec.md §4）。
 */
interface UpdateSettings {
  /** 是否启用自动检查更新（默认 true） */
  readonly autoCheck: boolean;
  /**
   * 是否接收预发布（beta）更新（默认 false）
   *
   * 稳定版用户开启后可收到 prerelease 版本的更新提示（electron-updater 的
   * allowPrerelease；GitHub 的 /releases/latest 天然跳过 prerelease，不开
   * 则稳定版永远只收正式版）。主进程在每次检查前读取（开启后手动"检查更新"
   * 立即生效）。装了 beta 版（版本号含 `-`）时恒为接收——库按版本判定的
   * 默认行为保留，开关只负责"稳定版主动 opt-in"。
   */
  readonly allowPrerelease: boolean;
  /**
   * 用户主动跳过的版本号（默认 null）
   *
   * 语义是"这个版本不再提醒"（顶栏徽标与 toast 静默），不阻断下载与安装——
   * 差分下载成本低，用户改主意时可点"取消跳过"或直接安装。出现更高版本时
   * 因版本号不等而自动失效（无需迁移逻辑）。
   */
  readonly skippedVersion: string | null;
}

/**
 * 窗口行为设置（docs/history/28-tray-spec.md §3/§7）
 *
 * closeAction 是关窗语义：minimize（默认）= 点 X 隐藏到托盘、后台能力继续；
 * quit = 点 X 走关窗协商后退出。主进程在关窗事件中实时读取（readSetting），
 * 渲染层的写穿透只负责持久化与设置页回显。
 */
interface WindowSettings {
  /** 点 X 的行为（默认 minimize） */
  readonly closeAction: 'quit' | 'minimize';
}

/**
 * 系统通知设置（主进程 tray.ts 发送前即时读取）
 *
 * 模板里唯一会发系统通知的场景是「首次最小化到托盘」的引导提示，
 * 故只有总开关一个维度；接入业务通知时在此追加事件级开关，
 * 并同步 src/main 侧消费方（否则又是一个空转开关）。
 */
interface NotificationSettings {
  /** 系统通知总开关（默认 true；false 时最小化引导提示不弹） */
  readonly enabled: boolean;
}

/**
 * 网络代理设置（34 号 spec：Node/Chromium 双栈出口的单一真源）
 *
 * 三模式（D4）：system=跟随系统（默认，V1 零行为变化）/ direct=强制直连 /
 * fixed=自定义代理。url 仅 fixed 时有效（http(s)，可内嵌凭据——日志侧已由
 * 主进程脱敏）；bypass 是主机后缀列表（localhost 家族主进程恒绕过，无需配置）。
 * 缺失/损坏语义 = system（fail-open 向既有行为）。
 */
interface ProxySettings {
  /** 代理模式 */
  readonly mode: 'system' | 'direct' | 'fixed';
  /** 代理地址（仅 mode=fixed；如 http://127.0.0.1:7890） */
  readonly url?: string;
  /** 不走代理的主机后缀（仅 mode=fixed；如 ['corp.example']） */
  readonly bypass?: readonly string[];
}

/**
 * 界面缩放设置（35 号 spec：主窗口整体缩放单一真源）
 *
 * zoom 为合法档位（ZOOM_LEVELS，1 = 100%）；快照/导入路径的损坏值在读侧
 * clampZoom 归一（superRefine 门禁只覆盖 settings:set 通道——双防线，35 号 §2.3）。
 * 缺失语义 = { zoom: 1 }。应用链 = AppShell useZoomEffect 单点（订阅本域）。
 */
interface AppearanceSettings {
  /** 缩放档位（1 = 100%） */
  readonly zoom: number;
}

/**
 * 应用界面语言
 *
 * P2 修复（S1 单真源残留）：语言此前经 i18next LanguageDetector 只写 localStorage，
 * 游离于 settings 写穿透链路之外（重装/多窗口不同步）。现在 SQLite 为真源，
 * localStorage 的语言缓存键（见 @/i18n/config 的 LANGUAGE_STORAGE_KEY）仅作 detector 的同步派生缓存。
 */
export type AppLanguage = 'zh-CN' | 'en';

/**
 * 用户设置数据形状（不含操作方法；DEFAULT_SETTINGS 与快照共用）
 */
interface SettingsData {
  /** 主题设置 */
  readonly theme: Theme;
  /** 界面语言（P2：纳入 SQLite 真源，见 AppLanguage 注释） */
  readonly language: AppLanguage;
  /** 快捷键设置 */
  readonly shortcuts: KeyboardShortcuts;
  /** 自动更新（自动检查开关） */
  readonly update: UpdateSettings;
  /** 窗口行为（关窗语义） */
  readonly window: WindowSettings;
  /** 系统通知（最小化到托盘的引导提示门控） */
  readonly notification: NotificationSettings;
  /** 网络代理（34 号：双栈出口单一真源） */
  readonly proxy: ProxySettings;
  /** 界面缩放（35 号：主窗口整体缩放） */
  readonly appearance: AppearanceSettings;
}

/**
 * 用户设置状态形状
 */
interface SettingsState extends SettingsData {
  /** 设置主题 */
  readonly setTheme: (theme: Theme) => void;
  /** 设置界面语言（写穿透落库 + 镜像 detector 缓存） */
  readonly setLanguage: (language: AppLanguage) => void;
  /** 更新快捷键设置（部分字段） */
  readonly updateShortcuts: (patch: Partial<KeyboardShortcuts>) => void;
  /** 更新自动更新设置（写穿透 SQLite；主进程下次启动读取生效） */
  readonly setUpdate: (patch: Partial<UpdateSettings>) => void;
  /** 更新窗口行为设置（写穿透 SQLite；主进程关窗事件实时读取） */
  readonly setWindow: (patch: Partial<WindowSettings>) => void;
  /** 更新系统通知设置（写穿透 SQLite；主进程发送通知前即时读取） */
  readonly updateNotification: (patch: Partial<NotificationSettings>) => void;
  /** 更新网络代理设置（写穿透 SQLite；主进程 settings:set 收口即时应用——V5） */
  readonly updateProxy: (patch: Partial<ProxySettings>) => void;
  /** 更新界面缩放（写穿透 SQLite；应用由 AppShell useZoomEffect 单点收敛） */
  readonly updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  /**
   * 应用「主进程主动变更的设置」（托盘菜单等）
   *
   * 与各 set / update 方法的关键区别：**只更新内存态、不回写**（变更来源就是主进程，
   * 回写是回声）。按域合并而非整快照覆盖——`SettingsData` 有多个域，整体替换会把
   * 未变更的域重置为默认值（`applySettingsSnapshot` 是启动专用，勿复用）。
   */
  readonly applyMainSettingChange: (key: SettingKey, value: unknown) => void;
}

/**
 * 写穿透：设置变更后 fire-and-forget 经 IPC 落库（SQLite 单一真源）
 *
 * window.api 未注入（浏览器模式/单测）时静默跳过——内存态仍可用。
 */
/**
 * 在途写入集合（2026-09-08 可靠性修复：退出丢失窗口）
 *
 * 此前 persistSetting 是纯 fire-and-forget——用户改设置后立刻退出应用，
 * 在途的 settings:set 可能尚未落库就被中断，最后一次变更丢失（回落到旧值）。
 * 这里记录每个在途 Promise，flushPendingSettings() 可在页面卸载前等待它们。
 */
const pendingWrites = new Set<Promise<unknown>>();

/**
 * 写失败待重试（2026-09-26）：同键后写覆盖前写。
 * 失败不再静默丢——内存与 SQLite 分叉会一直持续到「同键再写」；
 * 现记账并在 flushPendingSettings 时重试，pagehide 前尽量收敛。
 */
const failedWrites = new Map<SettingKey, unknown>();

/**
 * 等待所有在途设置写入落库，并重试失败键（供 main.tsx 注册 pagehide/beforeunload 调用）
 *
 * 注：pagehide 阶段无法阻塞卸载，但 Electron 渲染层退出前主进程会先收到
 * IPC，这里的等待能让绝大多数写入完成（fire-and-forget 的窗口从「整个进程
 * 生命周期」收敛到「同步调用栈」）。
 */
export async function flushPendingSettings(): Promise<void> {
  await Promise.allSettled([...pendingWrites]);
  if (failedWrites.size === 0) {
    return;
  }
  const retries = [...failedWrites.entries()].map(([key, value]) => {
    failedWrites.delete(key);
    return persistSettingAsync(key, value);
  });
  await Promise.allSettled(retries);
}

/** 单键写入（返回 Promise；成功不记账，失败写入 failedWrites 并 reportError） */
function persistSettingAsync(key: SettingKey, value: unknown): Promise<unknown> {
  const api = window.api;
  const setter = api?.settings?.set;
  if (typeof setter !== 'function') {
    return Promise.resolve(undefined);
  }
  return setter({ key, value }).catch((error: unknown) => {
    failedWrites.set(key, value);
    reportError(error, { tags: { scope: 'settings.persist', key } });
  });
}

function persistSetting(key: SettingKey, value: unknown): void {
  const write = persistSettingAsync(key, value).finally(() => {
    pendingWrites.delete(write);
  });
  pendingWrites.add(write);
}

/**
 * 旧版 v3 快捷键迁移（Meta+ → Ctrl+，Windows/Linux 平台归一化）
 *
 * S1：从 persist migrate 迁移为纯函数，供 settings-bootstrap 对
 * localStorage 旧数据与 SQLite 快照统一应用。
 */
export function migrateShortcuts<T extends object>(state: T): T {
  const shortcuts = (state as { readonly shortcuts?: unknown }).shortcuts as
    | Record<string, string>
    | undefined;
  if (shortcuts === undefined || IS_MAC) {
    return state;
  }
  const migrated: Record<string, string> = {};
  for (const [key, value] of Object.entries(shortcuts)) {
    migrated[key] =
      typeof value === 'string' && value.startsWith('Meta+')
        ? value.replace(/^Meta\+/, 'Ctrl+')
        : (value as string);
  }
  return { ...state, shortcuts: migrated } as T;
}

/**
 * 默认快捷键（36 号 C 导出：恢复默认入口与冲突检测共用此单一真源；
 * DEFAULT_SETTINGS.shortcuts 引用同一常量）
 */
export const DEFAULT_SHORTCUTS: KeyboardShortcuts = {
  commandPalette: `${MOD}+P`,
  toggleTheme: `${MOD}+Shift+T`,
  openSettings: `${MOD}+,`,
};

/** 默认设置（模块级常量；applySettingsSnapshot 覆盖） */
const DEFAULT_SETTINGS: SettingsData = {
  theme: 'dark',
  language: 'zh-CN',
  shortcuts: DEFAULT_SHORTCUTS,
  update: {
    autoCheck: true,
    allowPrerelease: false,
    skippedVersion: null,
  },
  window: {
    closeAction: 'minimize',
  },
  notification: {
    enabled: true,
  },
  proxy: {
    mode: 'system',
  },
  appearance: {
    zoom: DEFAULT_ZOOM,
  },
};

/**
 * 用户设置 Store（S1：内存态 + 写穿透落库）
 *
 * @example
 * ```tsx
 * const theme = useSettingsStore((s) => s.theme);
 * const setTheme = useSettingsStore((s) => s.setTheme);
 * ```
 */
export const useSettingsStore = create<SettingsState>()((set) => ({
  ...DEFAULT_SETTINGS,

  setTheme: (theme) => {
    set({ theme });
    persistSetting('theme', theme);
    mirrorThemeForFirstPaint(theme);
  },
  setLanguage: (language) => {
    set({ language });
    persistSetting('language', language);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {}
  },
  updateShortcuts: (patch) => {
    const shortcuts = { ...useSettingsStore.getState().shortcuts, ...patch };
    set({ shortcuts });
    persistSetting('shortcuts', shortcuts);
  },
  setUpdate: (patch) => {
    const update = { ...useSettingsStore.getState().update, ...patch };
    set({ update });
    persistSetting('update', update);
  },
  setWindow: (patch) => {
    const window = { ...useSettingsStore.getState().window, ...patch };
    set({ window });
    persistSetting('window', window);
  },
  updateNotification: (patch) => {
    const notification = { ...useSettingsStore.getState().notification, ...patch };
    set({ notification });
    persistSetting('notification', notification);
  },
  updateProxy: (patch) => {
    const proxy = { ...useSettingsStore.getState().proxy, ...patch };
    if (proxy.mode !== 'fixed') {
      delete (proxy as { url?: string; bypass?: readonly string[] }).url;
      delete (proxy as { url?: string; bypass?: readonly string[] }).bypass;
    }
    set({ proxy });
    persistSetting('proxy', proxy);
  },
  updateAppearance: (patch) => {
    const appearance = { ...useSettingsStore.getState().appearance, ...patch };
    set({ appearance });
    persistSetting('appearance', appearance);
  },
  applyMainSettingChange: (key, value) => {
    applyMainChange(key, value, set);
  },
}));

/** theme 合法值收窄（primitive 键专用） */
function asTheme(value: unknown): Theme | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null;
}

/** language 合法值收窄 */
function asLanguage(value: unknown): AppLanguage | null {
  return value === 'zh-CN' || value === 'en' ? value : null;
}

/**
 * 主进程主动变更的应用逻辑（模块级，压低 store action 认知复杂度）
 *
 * 只更新内存、不 persist：变更来源是主进程（SQLite 已写过），回写是回声。
 */
function applyMainChange(
  key: SettingKey,
  value: unknown,
  set: (partial: Partial<SettingsState>) => void,
): void {
  if (key === 'theme') {
    const theme = asTheme(value);
    if (theme !== null) set({ theme });
    return;
  }
  if (key === 'language') {
    const language = asLanguage(value);
    if (language !== null) {
      set({ language });
      changeLanguage(language);
    }
    return;
  }
  if (key === 'window' && typeof value === 'object' && value !== null) {
    set({ window: { ...useSettingsStore.getState().window, ...(value as WindowSettings) } });
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const current = useSettingsStore.getState() as unknown as Record<string, unknown>;
  const existing = current[key];
  if (typeof existing !== 'object' || existing === null) {
    return;
  }
  set({
    [key]: { ...(existing as Record<string, unknown>), ...(value as Record<string, unknown>) },
  } as Partial<SettingsState>);
}

/**
 * 应用启动快照（S1：main.tsx 在 render 前调用，覆盖默认值）
 *
 * @param snapshot settings:getAll 返回的 key → JSON 值映射（已含迁移处理）
 */
export function applySettingsSnapshot(snapshot: Readonly<Record<string, unknown>>): void {
  const theme = asTheme(snapshot['theme']) ?? DEFAULT_SETTINGS.theme;
  const language = asLanguage(snapshot['language']) ?? DEFAULT_SETTINGS.language;
  mirrorThemeForFirstPaint(theme);
  useSettingsStore.setState({
    theme,
    language,
    shortcuts: {
      ...DEFAULT_SETTINGS.shortcuts,
      ...((snapshot['shortcuts'] as Partial<KeyboardShortcuts> | undefined) ?? {}),
    },
    update: {
      ...DEFAULT_SETTINGS.update,
      ...((snapshot['update'] as Partial<UpdateSettings> | undefined) ?? {}),
    },
    window: {
      ...DEFAULT_SETTINGS.window,
      ...((snapshot['window'] as Partial<WindowSettings> | undefined) ?? {}),
    },
    notification: {
      ...DEFAULT_SETTINGS.notification,
      ...((snapshot['notification'] as Partial<NotificationSettings> | undefined) ?? {}),
    },
    proxy: {
      ...DEFAULT_SETTINGS.proxy,
      ...((snapshot['proxy'] as Partial<ProxySettings> | undefined) ?? {}),
    },
    appearance: {
      zoom: clampZoom((snapshot['appearance'] as { zoom?: unknown } | undefined)?.zoom as number),
    },
  });
}
