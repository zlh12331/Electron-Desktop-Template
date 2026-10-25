import { IPC_CHANNELS } from '@code-agent/shared/main';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setAsDefaultProtocolClient: vi.fn(() => true),
  getAllWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { setAsDefaultProtocolClient: mocks.setAsDefaultProtocolClient },
  // biome-ignore lint/style/useNamingConvention: 必须与 Electron 模块导出名一致
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
}));

vi.mock('./utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  broadcastDeepLink,
  clearPendingDeepLink,
  extractProtocolUrl,
  parseDeepLink,
  registerDeepLinkProtocol,
  setPendingDeepLink,
  takePendingDeepLink,
} from './deep-link';

type FakeWindow = {
  readonly isDestroyed: () => boolean;
  readonly webContents: { readonly send: ReturnType<typeof vi.fn> };
};

function fakeWindow(destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  };
}

describe('parseDeepLink', () => {
  it('路径段 /open/:id 优先', () => {
    expect(parseDeepLink('electron-template://open/abc-123').targetId).toBe('abc-123');
  });

  it('回退查询参数 target，并解码百分号编码', () => {
    expect(parseDeepLink('electron-template://open?target=abc%2D123').targetId).toBe('abc-123');
  });

  it('空 target、非法字符、超长 id 一律按仅唤起处理', () => {
    expect(parseDeepLink('electron-template://open?target=').targetId).toBeNull();
    expect(parseDeepLink('electron-template://open/%2e%2e%2fetc').targetId).toBeNull();
    expect(parseDeepLink(`electron-template://open/${'a'.repeat(129)}`).targetId).toBeNull();
  });

  it('非法 URL 保留原文但不解析出 target', () => {
    expect(parseDeepLink('not a url')).toEqual({ targetId: null, url: 'not a url' });
  });
});

describe('extractProtocolUrl', () => {
  it('返回首个协议 URL，忽略其他参数', () => {
    expect(
      extractProtocolUrl(['electron.exe', '--flag', 'electron-template://open/a', '--x']),
    ).toBe('electron-template://open/a');
  });

  it('无协议 URL 返回 null', () => {
    expect(extractProtocolUrl(['electron.exe', 'https://example.com'])).toBeNull();
  });
});

describe('pending deep link', () => {
  beforeEach(() => {
    clearPendingDeepLink();
  });

  it('最多消费一次，取走后清空', () => {
    const payload = parseDeepLink('electron-template://open/a');
    setPendingDeepLink(payload);
    expect(takePendingDeepLink()).toEqual(payload);
    expect(takePendingDeepLink()).toBeNull();
  });

  it('重复暂存以最后一次为准', () => {
    setPendingDeepLink(parseDeepLink('electron-template://open/first'));
    setPendingDeepLink(parseDeepLink('electron-template://open/second'));
    expect(takePendingDeepLink()?.targetId).toBe('second');
  });
});

describe('broadcastDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只向未销毁窗口广播', () => {
    const live = fakeWindow();
    const destroyed = fakeWindow(true);
    mocks.getAllWindows.mockReturnValue([live, destroyed]);

    const payload = parseDeepLink('electron-template://open/a');
    broadcastDeepLink(payload);

    expect(live.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS['APP_EVENT_DEEP_LINK'],
      payload,
    );
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });

  it('无窗口时不抛错', () => {
    mocks.getAllWindows.mockReturnValue([]);
    expect(() => broadcastDeepLink(parseDeepLink('electron-template://open'))).not.toThrow();
  });
});

describe('registerDeepLinkProtocol', () => {
  const processWithDefaultApp = process as NodeJS.Process & { defaultApp?: boolean };

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(processWithDefaultApp, 'defaultApp');
  });

  it('打包态只注册 scheme', () => {
    expect(registerDeepLinkProtocol()).toBe(true);
    expect(mocks.setAsDefaultProtocolClient).toHaveBeenCalledWith('electron-template');
  });

  it('dev（defaultApp）带上可执行文件与入口脚本，避免注册成 Electron 二进制', () => {
    const originalArgv = process.argv;
    process.argv = ['electron.exe', 'F:/app/out/main/index.js'];
    Object.defineProperty(processWithDefaultApp, 'defaultApp', {
      value: true,
      configurable: true,
    });
    try {
      expect(registerDeepLinkProtocol()).toBe(true);
      expect(mocks.setAsDefaultProtocolClient).toHaveBeenCalledWith(
        'electron-template',
        process.execPath,
        ['F:/app/out/main/index.js'],
      );
    } finally {
      Reflect.deleteProperty(processWithDefaultApp, 'defaultApp');
      process.argv = originalArgv;
    }
  });
});
