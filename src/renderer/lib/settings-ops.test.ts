import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearUpdateCache,
  detectSystemProxy,
  exportDiagnostics,
  exportSettingsFile,
  getLoginItemSettings,
  getUpdateCacheInfo,
  importSettingsFile,
  openDataDirChecked,
  openLogsDirChecked,
  resetAllSettings,
  setLoginItemSettings,
  subscribeLoginItemChanged,
  testProxyConnection,
} from './settings-ops';

const ok = <T>(data: T): { data: T } => ({ data });
const err = (code: string, message = 'boom'): { error: { code: string; message: string } } => ({
  error: { code, message },
});

const api = {
  update: { getCacheInfo: vi.fn(), clearCache: vi.fn() },
  settings: { exportSettings: vi.fn(), importSettings: vi.fn(), resetAll: vi.fn() },
  app: {
    openDataDir: vi.fn(),
    openLogsDir: vi.fn(),
    exportDiagnostics: vi.fn(),
    getLoginItemSettings: vi.fn(),
    setLoginItemSettings: vi.fn(),
    subscribeLoginItemChanged: vi.fn(),
  },
  proxy: { test: vi.fn(), detectSystem: vi.fn() },
};

function installApi(value: typeof api | undefined): void {
  Object.defineProperty(window, 'api', { value, writable: true, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi(api);
});

afterEach(() => {
  installApi(undefined);
});

describe('settings-ops · 有桥路径', () => {
  it('getUpdateCacheInfo：unwrap 后返回 data', async () => {
    api.update.getCacheInfo.mockResolvedValue(ok({ path: 'C:/c', bytes: 1, fileCount: 2 }));

    await expect(getUpdateCacheInfo()).resolves.toEqual({
      path: 'C:/c',
      bytes: 1,
      fileCount: 2,
    });
  });

  it('getUpdateCacheInfo：IPC 错误 → 抛带错误码的 Error（供调用方 catch）', async () => {
    api.update.getCacheInfo.mockResolvedValue(err('INTERNAL_ERROR'));

    await expect(getUpdateCacheInfo()).rejects.toThrow('[INTERNAL_ERROR] boom');
  });

  it('clearUpdateCache：透传清理结果', async () => {
    api.update.clearCache.mockResolvedValue(ok({ path: 'C:/c', bytes: 0, fileCount: 0 }));

    await expect(clearUpdateCache()).resolves.toEqual({ path: 'C:/c', bytes: 0, fileCount: 0 });
  });

  it('exportSettingsFile：透传 saved/path', async () => {
    api.settings.exportSettings.mockResolvedValue(ok({ saved: true, path: 'C:/s.json' }));

    await expect(exportSettingsFile()).resolves.toEqual({ saved: true, path: 'C:/s.json' });
  });

  it('importSettingsFile：透传导入计数', async () => {
    api.settings.importSettings.mockResolvedValue(ok({ imported: 2, skipped: 1 }));

    await expect(importSettingsFile()).resolves.toEqual({ imported: 2, skipped: 1 });
  });

  it('resetAllSettings：只返回 settings 字段（响应外壳不外泄）', async () => {
    api.settings.resetAll.mockResolvedValue(ok({ settings: { theme: 'dark' } }));

    await expect(resetAllSettings()).resolves.toEqual({ theme: 'dark' });
    expect(api.settings.resetAll).toHaveBeenCalledWith({});
  });

  it('openDataDirChecked：返回主进程回读的 ok 结果', async () => {
    api.app.openDataDir.mockResolvedValue(ok({ ok: false }));

    await expect(openDataDirChecked()).resolves.toEqual({ ok: false });
  });

  it('openLogsDirChecked：返回主进程回读的 ok 结果', async () => {
    api.app.openLogsDir.mockResolvedValue(ok({ ok: true }));

    await expect(openLogsDirChecked()).resolves.toEqual({ ok: true });
  });

  it('exportDiagnostics：透传 saved/path', async () => {
    api.app.exportDiagnostics.mockResolvedValue(ok({ saved: true, path: 'C:/diag.zip' }));

    await expect(exportDiagnostics()).resolves.toEqual({ saved: true, path: 'C:/diag.zip' });
  });

  it('getLoginItemSettings：透传三态', async () => {
    const state = { openAtLogin: true, supported: true, requiresApproval: false };
    api.app.getLoginItemSettings.mockResolvedValue(ok(state));

    await expect(getLoginItemSettings()).resolves.toEqual(state);
  });

  it('setLoginItemSettings：透传写入后的真实回读值', async () => {
    const state = { openAtLogin: false, supported: true, requiresApproval: false };
    api.app.setLoginItemSettings.mockResolvedValue(ok(state));

    await expect(setLoginItemSettings({ openAtLogin: false })).resolves.toEqual(state);
    expect(api.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it('subscribeLoginItemChanged：透传 handler 并返回退订函数', () => {
    const unsubscribe = vi.fn();
    api.app.subscribeLoginItemChanged.mockReturnValue(unsubscribe);
    const handler = vi.fn();

    expect(subscribeLoginItemChanged(handler)).toBe(unsubscribe);
    expect(api.app.subscribeLoginItemChanged).toHaveBeenCalledWith(handler);
  });

  it('testProxyConnection：透传测试结果', async () => {
    api.proxy.test.mockResolvedValue(ok({ ok: true, kind: 'ok', latencyMs: 42 }));

    await expect(testProxyConnection()).resolves.toEqual({ ok: true, kind: 'ok', latencyMs: 42 });
    expect(api.proxy.test).toHaveBeenCalledWith({});
  });

  it('testProxyConnection：透传草稿配置与自定义目标', async () => {
    api.proxy.test.mockResolvedValue(ok({ ok: true, kind: 'ok' }));
    const config = {
      mode: 'fixed' as const,
      protocol: 'socks5' as const,
      host: '127.0.0.1',
      port: 1080,
    };

    await testProxyConnection({ config, targetUrl: 'https://example.com/generate_204' });
    expect(api.proxy.test).toHaveBeenCalledWith({
      config,
      targetUrl: 'https://example.com/generate_204',
    });
  });

  it('detectSystemProxy：透传系统代理检测结果', async () => {
    api.proxy.detectSystem.mockResolvedValue(
      ok({ detected: true, protocol: 'http', host: '127.0.0.1', port: 7890 }),
    );
    await expect(detectSystemProxy()).resolves.toEqual({
      detected: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
  });
});

describe('settings-ops · 无桥兜底（浏览器模式 / preload 缺失）', () => {
  beforeEach(() => {
    installApi(undefined);
  });

  it('读类操作：抛 [BRIDGE_UNAVAILABLE]，调用方可静默处理', async () => {
    await expect(getUpdateCacheInfo()).rejects.toThrow('[BRIDGE_UNAVAILABLE]');
    await expect(clearUpdateCache()).rejects.toThrow('[BRIDGE_UNAVAILABLE]');
    await expect(resetAllSettings()).rejects.toThrow('[BRIDGE_UNAVAILABLE]');
    await expect(openDataDirChecked()).rejects.toThrow('[BRIDGE_UNAVAILABLE]');
    await expect(getLoginItemSettings()).rejects.toThrow('[BRIDGE_UNAVAILABLE]');
  });

  it('导出设置：视为用户取消（saved:false），不误报失败', async () => {
    await expect(exportSettingsFile()).resolves.toEqual({ saved: false });
  });

  it('导入设置：返回零计数（调用方按取消分支处理）', async () => {
    await expect(importSettingsFile()).resolves.toEqual({ imported: 0, skipped: 0 });
  });

  it('导出诊断包：返回 null（调用方静默返回）', async () => {
    await expect(exportDiagnostics()).resolves.toBeNull();
  });

  it('设置开机自启：返回 null（静默不操作）', async () => {
    await expect(setLoginItemSettings({ openAtLogin: true })).resolves.toBeNull();
  });

  it('订阅开机自启变更：返回 no-op 退订函数', () => {
    const unsubscribe = subscribeLoginItemChanged(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });

  it('代理测试：返回 not-applicable（UI 可用，行为无感）', async () => {
    await expect(testProxyConnection()).resolves.toEqual({ ok: false, kind: 'not-applicable' });
  });

  it('系统代理检测：无桥返回 detected=false', async () => {
    await expect(detectSystemProxy()).resolves.toEqual({ detected: false });
  });
});
