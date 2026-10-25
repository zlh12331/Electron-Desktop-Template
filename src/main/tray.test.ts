import type { UpdateStatusPayload } from '@code-agent/shared/main';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeMenuItem {
  readonly label?: string;
  readonly type?: string;
  readonly checked?: boolean;
  readonly enabled?: boolean;
  readonly click?: () => void;
}

interface FakeNotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly silent?: boolean;
}

const mocks = vi.hoisted(() => {
  class FakeTray {
    static readonly instances: FakeTray[] = [];
    readonly handlers = new Map<string, () => void>();
    readonly setToolTip = vi.fn();
    readonly popUpContextMenu = vi.fn();

    constructor(readonly image: unknown) {
      FakeTray.instances.push(this);
    }

    on(event: string, handler: () => void): void {
      this.handlers.set(event, handler);
    }
  }

  class FakeNotification {
    static readonly instances: FakeNotification[] = [];
    static supported = true;
    readonly handlers = new Map<string, () => void>();
    readonly show = vi.fn();

    static isSupported(): boolean {
      return FakeNotification.supported;
    }

    constructor(readonly options: FakeNotificationOptions) {
      FakeNotification.instances.push(this);
    }

    on(event: string, handler: () => void): void {
      this.handlers.set(event, handler);
    }
  }

  const emptyImage = {
    isEmpty: () => true,
    setTemplateImage: vi.fn(),
    addRepresentation: vi.fn(),
    toPNG: () => Buffer.from(''),
    resize: () => emptyImage,
  };

  const menuTemplates: FakeMenuItem[][] = [];

  return {
    fakeTray: FakeTray,
    fakeNotification: FakeNotification,
    emptyImage,
    menuTemplates,
    appQuit: vi.fn(),
    buildFromTemplate: vi.fn((template: FakeMenuItem[]) => {
      menuTemplates.push(template);
      return { template };
    }),
    readSetting: vi.fn(),
    writeSetting: vi.fn(),
    readAutostartState: vi.fn(),
    showMainWindow: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'C:/app',
    getName: () => 'Fixture App',
    quit: mocks.appQuit,
  },
  // biome-ignore lint/style/useNamingConvention: mock electron Tray export，需匹配 SDK 原名
  Tray: mocks.fakeTray,
  // biome-ignore lint/style/useNamingConvention: mock electron Menu export，需匹配 SDK 原名
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  // biome-ignore lint/style/useNamingConvention: mock electron Notification export，需匹配 SDK 原名
  Notification: mocks.fakeNotification,
  nativeImage: {
    createFromPath: () => mocks.emptyImage,
    createEmpty: () => mocks.emptyImage,
  },
}));

vi.mock('./infra/autostart/autostart', () => ({
  createAutostartDeps: () => ({}),
  readAutostartState: mocks.readAutostartState,
}));

vi.mock('./infra/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('./infra/storage/settings-pref', () => ({
  readSetting: mocks.readSetting,
  writeSetting: mocks.writeSetting,
}));

vi.mock('./utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./window-show', () => ({
  showMainWindow: mocks.showMainWindow,
}));

type TrayDeps = Parameters<typeof import('./tray').createTray>[0];

function createDeps(status: UpdateStatusPayload | null = null): TrayDeps {
  let currentStatus = status;
  let closeAction: 'minimize' | 'quit' = 'minimize';
  const deps: TrayDeps = {
    getUpdateStatus: () => currentStatus,
    checkForUpdate: vi.fn(),
    installUpdate: vi.fn(),
    setAutostart: vi.fn(),
    getCloseAction: () => closeAction,
    setCloseAction: vi.fn((next) => {
      closeAction = next;
    }),
    onUpdateStatus: vi.fn(() => vi.fn()),
  };
  return Object.assign(deps, {
    setStatus: (next: UpdateStatusPayload | null) => {
      currentStatus = next;
    },
  }) as TrayDeps & { setStatus: (next: UpdateStatusPayload | null) => void };
}

async function loadTray(): Promise<{
  createTray: typeof import('./tray').createTray;
  notifyMinimizedToTray: typeof import('./tray').notifyMinimizedToTray;
}> {
  vi.resetModules();
  return await import('./tray');
}

async function openMenu(): Promise<FakeMenuItem[]> {
  const tray = mocks.fakeTray.instances.at(-1);
  if (tray === undefined) {
    throw new Error('托盘未创建');
  }
  tray.handlers.get('right-click')?.();
  await vi.waitFor(() => expect(mocks.buildFromTemplate).toHaveBeenCalled());
  return mocks.menuTemplates.at(-1) ?? [];
}

describe('tray', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fakeTray.instances.length = 0;
    mocks.fakeNotification.instances.length = 0;
    mocks.fakeNotification.supported = true;
    mocks.menuTemplates.length = 0;
    mocks.readAutostartState.mockResolvedValue({
      openAtLogin: true,
      supported: true,
      requiresApproval: false,
    });
    mocks.readSetting.mockImplementation((key: string) =>
      key === 'notification' ? { enabled: true } : false,
    );
  });

  it('创建单例、注册点击与右键，tooltip 随更新状态更新', async () => {
    const { createTray } = await loadTray();
    const deps = createDeps();
    const onUpdateStatus = deps.onUpdateStatus as ReturnType<typeof vi.fn>;
    onUpdateStatus.mockReturnValue(vi.fn());

    createTray(deps);
    createTray(deps);

    expect(mocks.fakeTray.instances).toHaveLength(1);
    const tray = mocks.fakeTray.instances[0];
    expect(tray?.handlers.has('click')).toBe(true);
    expect(tray?.handlers.has('right-click')).toBe(true);
    expect(tray?.setToolTip).toHaveBeenLastCalledWith('Fixture App');

    (deps as TrayDeps & { setStatus: (next: UpdateStatusPayload | null) => void }).setStatus({
      phase: 'downloading',
      progress: 42,
    });
    const statusListener = onUpdateStatus.mock.calls[0]?.[0] as
      | ((payload: UpdateStatusPayload) => void)
      | undefined;
    statusListener?.({ phase: 'downloading', progress: 42 });
    expect(tray?.setToolTip).toHaveBeenLastCalledWith('Fixture App — tray.downloading 42%');

    tray?.handlers.get('click')?.();
    expect(mocks.showMainWindow).toHaveBeenCalledOnce();
  });

  it('菜单：正常/下载中/已下载三种首项 + 自启/关窗/退出动作', async () => {
    const { createTray } = await loadTray();
    const deps = createDeps();
    createTray(deps);

    const normal = await openMenu();
    expect(normal[0]).toMatchObject({ label: 'tray.checkUpdate' });
    normal[0]?.click?.();
    expect(deps.checkForUpdate).toHaveBeenCalledOnce();

    const autostart = normal.find((item) => item.label === 'tray.autostart');
    expect(autostart).toMatchObject({ type: 'checkbox', checked: true });
    autostart?.click?.();
    expect(deps.setAutostart).toHaveBeenCalledWith(false);

    const closeToTray = normal.find((item) => item.label === 'tray.closeToTray');
    expect(closeToTray).toMatchObject({ type: 'checkbox', checked: true });
    closeToTray?.click?.();
    expect(deps.setCloseAction).toHaveBeenCalledWith('quit');

    normal.find((item) => item.label === 'tray.quit')?.click?.();
    expect(mocks.appQuit).toHaveBeenCalledOnce();

    (deps as TrayDeps & { setStatus: (next: UpdateStatusPayload | null) => void }).setStatus({
      phase: 'downloading',
      progress: 7,
    });
    const downloading = await openMenu();
    expect(downloading[0]).toMatchObject({ label: 'tray.downloading 7%', enabled: false });

    (deps as TrayDeps & { setStatus: (next: UpdateStatusPayload | null) => void }).setStatus({
      phase: 'downloaded',
      version: '1.2.3',
    });
    const downloaded = await openMenu();
    expect(downloaded[0]).toMatchObject({ label: 'tray.installUpdate' });
    downloaded[0]?.click?.();
    expect(deps.installUpdate).toHaveBeenCalledOnce();
  });

  it('自启不可用时菜单项禁用但勾选状态仍来自回读值', async () => {
    mocks.readAutostartState.mockResolvedValue({
      openAtLogin: false,
      supported: false,
      requiresApproval: false,
    });
    const { createTray } = await loadTray();
    const deps = createDeps();
    createTray(deps);

    const menu = await openMenu();
    expect(menu.find((item) => item.label === 'tray.autostart')).toMatchObject({
      type: 'checkbox',
      checked: false,
      enabled: false,
    });
  });

  it('最小化引导通知：只在首次显示，点击唤回主窗', async () => {
    const { createTray, notifyMinimizedToTray } = await loadTray();
    createTray(createDeps());

    notifyMinimizedToTray();

    expect(mocks.writeSetting).toHaveBeenCalledWith('window.hideHintShown', true);
    expect(mocks.fakeNotification.instances).toHaveLength(1);
    const notification = mocks.fakeNotification.instances[0];
    expect(notification?.options).toMatchObject({ title: 'Fixture App', silent: true });
    expect(notification?.show).toHaveBeenCalledOnce();
    notification?.handlers.get('click')?.();
    expect(mocks.showMainWindow).toHaveBeenCalledOnce();
  });

  it('通知总开关关闭、已提示过或系统不支持时不发通知', async () => {
    const { createTray, notifyMinimizedToTray } = await loadTray();
    createTray(createDeps());

    mocks.readSetting.mockImplementation((key: string) =>
      key === 'notification' ? { enabled: false } : false,
    );
    notifyMinimizedToTray();
    expect(mocks.fakeNotification.instances).toHaveLength(0);

    mocks.readSetting.mockImplementation((key: string) =>
      key === 'notification' ? { enabled: true } : key === 'window.hideHintShown',
    );
    notifyMinimizedToTray();
    expect(mocks.fakeNotification.instances).toHaveLength(0);

    mocks.readSetting.mockImplementation((key: string) =>
      key === 'notification' ? { enabled: true } : false,
    );
    mocks.fakeNotification.supported = false;
    notifyMinimizedToTray();
    expect(mocks.fakeNotification.instances).toHaveLength(0);
    expect(mocks.writeSetting).not.toHaveBeenCalled();
  });
});
