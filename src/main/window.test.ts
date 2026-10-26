import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rendererEntryFileUrl } from './security/renderer-url';

type EventHandler = (...args: unknown[]) => void;
type OpenHandler = (details: { url: string }) => unknown;

const mocks = vi.hoisted(() => {
  class FakeWebContents {
    readonly id = 1;
    readonly handlers = new Map<string, EventHandler>();
    readonly setWindowOpenHandler = vi.fn((handler: OpenHandler) => {
      this.openHandler = handler;
    });

    readonly openDevTools = vi.fn();
    readonly reload = vi.fn();
    openHandler: OpenHandler | null = null;

    on(event: string, handler: EventHandler): void {
      this.handlers.set(event, handler);
    }
  }

  class FakeWindow {
    static readonly instances: FakeWindow[] = [];

    readonly webContents = new FakeWebContents();
    readonly handlers = new Map<string, EventHandler>();
    readonly onceHandlers = new Map<string, EventHandler>();
    readonly loadURL = vi.fn();
    readonly loadFile = vi.fn();
    readonly show = vi.fn();
    readonly maximize = vi.fn();
    readonly hide = vi.fn();

    constructor(readonly options: unknown) {
      FakeWindow.instances.push(this);
    }

    on(event: string, handler: EventHandler): void {
      this.handlers.set(event, handler);
    }

    once(event: string, handler: EventHandler): void {
      this.onceHandlers.set(event, handler);
    }
  }

  return {
    windowCtor: FakeWindow,
    isPackaged: false,
    getPath: vi.fn(() => 'C:/userData'),
    getAppPath: vi.fn(() => 'C:/app'),
    openExternal: vi.fn(),
    readSetting: vi.fn(),
    loadWindowState: vi.fn(),
    trackWindowState: vi.fn(),
    resolveStartHidden: vi.fn(),
    isQuitting: vi.fn(),
    isCloseConfirmed: vi.fn(),
    notifyMinimizedToTray: vi.fn(),
    reportError: vi.fn(),
    reportMessage: vi.fn(),
    markMaximizeOnNextShow: vi.fn(),
    bindStartupWindow: vi.fn(),
    recordStartupReady: vi.fn(),
    recordRendererCrash: vi.fn(),
    installExtension: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getPath: mocks.getPath,
    getAppPath: mocks.getAppPath,
  },
  // biome-ignore lint/style/useNamingConvention: mock electron BrowserWindow 导出名
  BrowserWindow: mocks.windowCtor,
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  },
  shell: { openExternal: mocks.openExternal },
}));

vi.mock('electron-devtools-installer', () => ({
  installExtension: mocks.installExtension,
  // biome-ignore lint/style/useNamingConvention: mock electron-devtools-installer 导出名
  REACT_DEVELOPER_TOOLS: 'react-devtools',
}));

vi.mock('./infra/autostart/autostart', () => ({
  resolveStartHidden: mocks.resolveStartHidden,
}));

vi.mock('./infra/storage/settings-pref', () => ({
  readSetting: mocks.readSetting,
}));

vi.mock('./infra/storage/window-state', () => ({
  loadWindowState: mocks.loadWindowState,
  trackWindowState: mocks.trackWindowState,
}));

vi.mock('./infra/telemetry/otel-metrics', () => ({
  recordRendererCrash: mocks.recordRendererCrash,
}));

vi.mock('./infra/telemetry/startup', () => ({
  bindStartupWindow: mocks.bindStartupWindow,
  recordStartupReady: mocks.recordStartupReady,
}));

vi.mock('./quit-state', () => ({
  isQuitting: mocks.isQuitting,
  isCloseConfirmed: mocks.isCloseConfirmed,
}));

vi.mock('./tray', () => ({
  notifyMinimizedToTray: mocks.notifyMinimizedToTray,
}));

vi.mock('./utils/error-report', () => ({
  reportError: mocks.reportError,
  reportMessage: mocks.reportMessage,
}));

vi.mock('./utils/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('./window-show', () => ({
  markMaximizeOnNextShow: mocks.markMaximizeOnNextShow,
}));

vi.mock('./window-theme', () => ({
  // biome-ignore lint/style/useNamingConvention: mock window-theme 导出名
  TITLE_BAR_SYMBOL: { dark: '#fff' },
}));

type FakeWindow = InstanceType<typeof mocks.windowCtor>;

function fire(handler: EventHandler | undefined, ...args: unknown[]): void {
  if (handler === undefined) {
    throw new Error('窗口事件处理器未注册');
  }
  handler(...args);
}

function createHarness(): FakeWindow {
  const win = createWindow() as unknown as FakeWindow;
  return win;
}

// 在 hoisted mocks 之后导入，确保 window.ts 拿到替身
const { createWindow, readCloseAction } = await import('./window');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.windowCtor.instances.length = 0;
  mocks.isPackaged = false;
  mocks.getPath.mockReturnValue('C:/userData');
  mocks.getAppPath.mockReturnValue('C:/app');
  mocks.readSetting.mockReturnValue({ closeAction: 'minimize' });
  mocks.loadWindowState.mockReturnValue({ width: 1280, height: 800, isMaximized: false });
  mocks.resolveStartHidden.mockReturnValue(false);
  mocks.isQuitting.mockReturnValue(false);
  mocks.isCloseConfirmed.mockReturnValue(false);
  mocks.installExtension.mockResolvedValue('React DevTools');
  delete process.env['ELECTRON_RENDERER_URL'];
  delete process.env['APP_SKIP_CLOSE_GUARD'];
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env['ELECTRON_RENDERER_URL'];
  delete process.env['APP_SKIP_CLOSE_GUARD'];
});

describe('readCloseAction', () => {
  it('缺失/损坏/异常均回落 minimize，quit 才返回 quit', () => {
    expect(readCloseAction()).toBe('minimize');

    mocks.readSetting.mockReturnValue({ closeAction: 'quit' });
    expect(readCloseAction()).toBe('quit');

    mocks.readSetting.mockReturnValue({ closeAction: 'unknown' });
    expect(readCloseAction()).toBe('minimize');

    mocks.readSetting.mockReturnValue(null);
    expect(readCloseAction()).toBe('minimize');

    mocks.readSetting.mockImplementation(() => {
      throw new Error('db unavailable');
    });
    expect(readCloseAction()).toBe('minimize');
  });
});

describe('createWindow', () => {
  it('dev 无 dev server URL：加载产物、安装 DevTools、使用安全基线', async () => {
    const win = createHarness();

    expect(win.loadFile).toHaveBeenCalled();
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(mocks.installExtension).toHaveBeenCalledWith('react-devtools');
    expect(win.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    expect(win.options).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    await Promise.resolve();
  });

  it('dev 配置 ELECTRON_RENDERER_URL：走 loadURL', () => {
    mocks.isPackaged = false;
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');

    const win = createHarness();

    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it('打包态忽略 ELECTRON_RENDERER_URL / APP_SKIP_CLOSE_GUARD，仍只加载产物', () => {
    mocks.isPackaged = true;
    vi.stubEnv('ELECTRON_RENDERER_URL', 'https://evil.example');
    vi.stubEnv('APP_SKIP_CLOSE_GUARD', '1');

    const win = createHarness();

    expect(win.loadURL).not.toHaveBeenCalled();
    expect(win.loadFile).toHaveBeenCalled();
    expect(mocks.installExtension).not.toHaveBeenCalled();
    expect(win.webContents.openDevTools).not.toHaveBeenCalled();
  });

  it('导航白名单：产物入口放行，外站拦截', () => {
    const win = createHarness();
    const navigation = win.webContents.handlers.get('will-navigate');
    const allowedEvent = { preventDefault: vi.fn() };
    fire(navigation, allowedEvent, rendererEntryFileUrl('C:/app'));
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();

    const blockedEvent = { preventDefault: vi.fn() };
    fire(navigation, blockedEvent, 'https://evil.example/');
    expect(blockedEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('window.open 只把 http(s) 交系统浏览器，其余拒绝且不在应用内开窗', () => {
    const win = createHarness();
    const openHandler = win.webContents.openHandler;
    if (openHandler === null) {
      throw new Error('setWindowOpenHandler 未注册');
    }

    expect(openHandler({ url: 'https://example.com/doc' })).toEqual({ action: 'deny' });
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/doc');

    mocks.openExternal.mockClear();
    expect(openHandler({ url: 'file:///C:/secret.txt' })).toEqual({ action: 'deny' });
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('ready-to-show：恢复最大化并显示', () => {
    mocks.loadWindowState.mockReturnValue({ width: 1280, height: 800, isMaximized: true });
    mocks.resolveStartHidden.mockReturnValue(false);
    const win = createHarness();

    fire(win.onceHandlers.get('ready-to-show'));

    expect(mocks.recordStartupReady).toHaveBeenCalledWith(1, 'ready-to-show');
    expect(win.maximize).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
  });

  it('静默启动：ready-to-show 不显示窗口', () => {
    mocks.resolveStartHidden.mockReturnValue(true);
    const win = createHarness();

    fire(win.onceHandlers.get('ready-to-show'));

    expect(win.show).not.toHaveBeenCalled();
  });

  it('did-fail-load：仅主框架且非 -3 时上报', () => {
    const win = createHarness();
    const handler = win.webContents.handlers.get('did-fail-load');

    fire(handler, {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:5173', true);
    expect(mocks.reportError).toHaveBeenCalledOnce();

    mocks.reportError.mockClear();
    fire(handler, {}, -3, 'ERR_ABORTED', 'http://localhost:5173', true);
    expect(mocks.reportError).not.toHaveBeenCalled();

    fire(handler, {}, -102, 'ERR_CONNECTION_REFUSED', 'https://frame.example', false);
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it('渲染进程崩溃自愈：60 秒内最多 reload 两次，之后停止并提示', () => {
    const win = createHarness();
    const handler = win.webContents.handlers.get('render-process-gone');

    fire(handler, {}, { reason: 'crashed', exitCode: 1 });
    fire(handler, {}, { reason: 'crashed', exitCode: 1 });
    fire(handler, {}, { reason: 'crashed', exitCode: 1 });

    expect(win.webContents.reload).toHaveBeenCalledTimes(2);
    expect(mocks.reportMessage).toHaveBeenCalledOnce();
    expect(mocks.recordRendererCrash).toHaveBeenLastCalledWith('crashed', 'stopped');

    mocks.recordRendererCrash.mockClear();
    fire(handler, {}, { reason: 'clean-exit', exitCode: 0 });
    expect(mocks.recordRendererCrash).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'darwin')(
    '关窗行为：minimize 隐藏到托盘，quit 放行；dev 的 APP_SKIP_CLOSE_GUARD 生效',
    () => {
      const minimizeWindow = createHarness();
      const closeEvent = { preventDefault: vi.fn() };
      fire(minimizeWindow.handlers.get('close'), closeEvent);
      expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
      expect(minimizeWindow.hide).toHaveBeenCalledOnce();
      expect(mocks.notifyMinimizedToTray).toHaveBeenCalledOnce();

      mocks.readSetting.mockReturnValue({ closeAction: 'quit' });
      const quitWindow = createHarness();
      const quitEvent = { preventDefault: vi.fn() };
      fire(quitWindow.handlers.get('close'), quitEvent);
      expect(quitEvent.preventDefault).not.toHaveBeenCalled();
      expect(quitWindow.hide).not.toHaveBeenCalled();

      vi.stubEnv('APP_SKIP_CLOSE_GUARD', '1');
      const skippedWindow = createHarness();
      const skippedEvent = { preventDefault: vi.fn() };
      fire(skippedWindow.handlers.get('close'), skippedEvent);
      expect(skippedEvent.preventDefault).not.toHaveBeenCalled();
      expect(skippedWindow.hide).not.toHaveBeenCalled();
    },
  );

  it.skipIf(process.platform === 'darwin')(
    '打包态不信任 APP_SKIP_CLOSE_GUARD：关窗仍按 minimize 隐藏',
    () => {
      mocks.isPackaged = true;
      vi.stubEnv('APP_SKIP_CLOSE_GUARD', '1');
      const win = createHarness();
      const closeEvent = { preventDefault: vi.fn() };

      fire(win.handlers.get('close'), closeEvent);

      expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
      expect(win.hide).toHaveBeenCalledOnce();
    },
  );

  it.skipIf(process.platform === 'darwin')('isQuitting 时放行关窗', () => {
    mocks.isQuitting.mockReturnValue(true);
    const win = createHarness();
    const closeEvent = { preventDefault: vi.fn() };

    fire(win.handlers.get('close'), closeEvent);

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('跟踪窗口状态', () => {
    const win = createHarness();
    expect(mocks.trackWindowState).toHaveBeenCalledWith(
      win,
      join('C:/userData', 'window-state.json'),
    );
  });
});
