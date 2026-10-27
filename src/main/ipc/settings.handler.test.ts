import { SETTING_KEYS } from '@code-agent/shared/main';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcHandlerContext } from './wrap';

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  appGetPath: vi.fn(() => 'C:/documents'),
  appGetLocale: vi.fn(() => 'zh-CN'),
  setMainLanguage: vi.fn(),
  applyLogLevel: vi.fn(),
  applyProxySetting: vi.fn(),
  clearProxyAuthCredentials: vi.fn(),
  enrichProxySetting: vi.fn(),
  sanitizeProxySetting: vi.fn(),
  applySettingsImport: vi.fn(),
  buildSettingsExportFile: vi.fn(),
  replaceSettingInImportPayload: vi.fn(),
  validateSettingsImport: vi.fn(),
  deleteSettings: vi.fn(),
  readAllSettings: vi.fn(),
  writeSetting: vi.fn(),
  readTelemetryLevelSync: vi.fn(),
  writeTelemetryLevel: vi.fn(),
  broadcastSettingChanged: vi.fn(),
  readJsonImportFile: vi.fn(),
  syncTitleBarOverlayFromTheme: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mocks.writeFile,
}));

vi.mock('electron', () => ({
  app: { getPath: mocks.appGetPath, getLocale: mocks.appGetLocale },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
    showOpenDialog: mocks.showOpenDialog,
  },
}));

vi.mock('../infra/i18n', () => ({
  // biome-ignore lint/style/useNamingConvention: mock i18n 导出名
  DEFAULT_MAIN_LANGUAGE: 'zh-CN',
  setMainLanguage: mocks.setMainLanguage,
  t: (key: string) => key,
}));

vi.mock('../infra/network/proxy-credentials', () => ({
  applyProxySetting: mocks.applyProxySetting,
  clearProxyAuthCredentials: mocks.clearProxyAuthCredentials,
  enrichProxySetting: mocks.enrichProxySetting,
  sanitizeProxySetting: mocks.sanitizeProxySetting,
}));

vi.mock('../infra/storage/settings-io', () => ({
  applySettingsImport: mocks.applySettingsImport,
  buildSettingsExportFile: mocks.buildSettingsExportFile,
  replaceSettingInImportPayload: mocks.replaceSettingInImportPayload,
  validateSettingsImport: mocks.validateSettingsImport,
}));

vi.mock('../infra/storage/settings-pref', () => ({
  deleteSettings: mocks.deleteSettings,
  readAllSettings: mocks.readAllSettings,
  writeSetting: mocks.writeSetting,
}));

vi.mock('../infra/storage/telemetry-pref', () => ({
  readTelemetryLevelSync: mocks.readTelemetryLevelSync,
  writeTelemetryLevel: mocks.writeTelemetryLevel,
}));

vi.mock('../main-events', () => ({
  broadcastSettingChanged: mocks.broadcastSettingChanged,
}));

vi.mock('../utils/json-file', () => ({
  readJsonImportFile: mocks.readJsonImportFile,
}));

vi.mock('../utils/logger', () => ({
  applyLogLevel: mocks.applyLogLevel,
  logger: mocks.logger,
}));

vi.mock('../window-theme', () => ({
  syncTitleBarOverlayFromTheme: mocks.syncTitleBarOverlayFromTheme,
}));

const { settingsHandlers } = await import('./settings.handler');

const ctx: IpcHandlerContext = { traceId: 'test-trace', sender: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appGetPath.mockReturnValue('C:/documents');
  mocks.readAllSettings.mockReturnValue({});
  mocks.buildSettingsExportFile.mockReturnValue({ version: 1, settings: {} });
  mocks.sanitizeProxySetting.mockResolvedValue({ mode: 'system' });
  mocks.enrichProxySetting.mockResolvedValue({ mode: 'system' });
  mocks.writeFile.mockResolvedValue(undefined);
});

describe('settingsHandlers.getAll', () => {
  it('返回设置快照并同步主题标题栏；proxy 经 keychain 回填', async () => {
    mocks.readAllSettings.mockReturnValue({ theme: 'dark' });
    await expect(settingsHandlers.getAll({}, ctx)).resolves.toEqual({
      settings: { theme: 'dark' },
    });
    expect(mocks.syncTitleBarOverlayFromTheme).toHaveBeenCalledWith('dark');
    expect(mocks.enrichProxySetting).not.toHaveBeenCalled();

    mocks.readAllSettings.mockReturnValue({ proxy: { mode: 'system' } });
    mocks.enrichProxySetting.mockResolvedValue({ mode: 'system', hasAuth: true });
    await expect(settingsHandlers.getAll({}, ctx)).resolves.toEqual({
      settings: { proxy: { mode: 'system', hasAuth: true } },
    });
    expect(mocks.enrichProxySetting).toHaveBeenCalledWith({ mode: 'system' });
  });
});

describe('settingsHandlers.set', () => {
  it('theme/language 写库并分发主进程副作用，日志不落值', async () => {
    await settingsHandlers.set({ key: 'theme', value: 'dark' }, ctx);
    expect(mocks.writeSetting).toHaveBeenCalledWith('theme', 'dark');
    expect(mocks.syncTitleBarOverlayFromTheme).toHaveBeenCalledWith('dark');
    expect(mocks.setMainLanguage).not.toHaveBeenCalled();
    expect(mocks.broadcastSettingChanged).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith({ key: 'theme' }, '设置已更新');

    await settingsHandlers.set({ key: 'language', value: 'en' }, ctx);
    expect(mocks.writeSetting).toHaveBeenCalledWith('language', 'en');
    expect(mocks.setMainLanguage).toHaveBeenCalledWith('en', 'zh-CN');
  });

  it('logging 写库并即时应用 verbose 级别', async () => {
    await settingsHandlers.set({ key: 'logging', value: { verbose: true } }, ctx);
    expect(mocks.writeSetting).toHaveBeenCalledWith('logging', { verbose: true });
    expect(mocks.applyLogLevel).toHaveBeenCalledWith(true);
  });

  it('proxy 先拆凭据落库，再应用并广播回填后的值', async () => {
    mocks.sanitizeProxySetting.mockResolvedValue({ mode: 'fixed', url: 'http://127.0.0.1:7890' });
    mocks.enrichProxySetting.mockResolvedValue({ mode: 'fixed', hasAuth: true });

    await settingsHandlers.set({ key: 'proxy', value: { mode: 'fixed' } }, ctx);

    expect(mocks.sanitizeProxySetting).toHaveBeenCalledWith({ mode: 'fixed' });
    expect(mocks.writeSetting).toHaveBeenCalledWith('proxy', {
      mode: 'fixed',
      url: 'http://127.0.0.1:7890',
    });
    expect(mocks.applyProxySetting).toHaveBeenCalledWith({
      mode: 'fixed',
      url: 'http://127.0.0.1:7890',
    });
    expect(mocks.broadcastSettingChanged).toHaveBeenCalledWith('proxy', {
      mode: 'fixed',
      hasAuth: true,
    });
  });
});

describe('settingsHandlers.exportSettings', () => {
  it('取消时不写文件', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(settingsHandlers.exportSettings(undefined, ctx)).resolves.toEqual({
      saved: false,
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('选定路径后写出 JSON 并返回路径', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/out.json' });
    mocks.buildSettingsExportFile.mockReturnValue({ version: 1, settings: { theme: 'dark' } });

    await expect(settingsHandlers.exportSettings(undefined, ctx)).resolves.toEqual({
      saved: true,
      path: 'C:/out.json',
    });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      'C:/out.json',
      JSON.stringify({ version: 1, settings: { theme: 'dark' } }),
      'utf8',
    );
  });

  it('写文件失败时抛出并记录错误', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/out.json' });
    mocks.writeFile.mockRejectedValue(new Error('disk full'));

    await expect(settingsHandlers.exportSettings(undefined, ctx)).rejects.toThrow('disk full');
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});

describe('settingsHandlers.importSettings', () => {
  const payload = { version: 1, settings: { theme: 'dark', language: 'en' } };

  it('取消时不读文件', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(settingsHandlers.importSettings(undefined, ctx)).resolves.toEqual({
      imported: 0,
      skipped: 0,
    });
    expect(mocks.readJsonImportFile).not.toHaveBeenCalled();
  });

  it('无 proxy 时逐键应用并广播', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/in.json'] });
    mocks.readJsonImportFile.mockResolvedValue(payload);
    mocks.validateSettingsImport.mockReturnValue({
      imported: 2,
      skipped: 0,
      applied: [
        { key: 'theme', value: 'dark' },
        { key: 'language', value: 'en' },
      ],
    });
    mocks.applySettingsImport.mockReturnValue({
      imported: 2,
      skipped: 0,
      applied: [
        { key: 'theme', value: 'dark' },
        { key: 'language', value: 'en' },
      ],
    });

    await expect(settingsHandlers.importSettings(undefined, ctx)).resolves.toEqual({
      imported: 2,
      skipped: 0,
    });
    expect(mocks.replaceSettingInImportPayload).not.toHaveBeenCalled();
    expect(mocks.syncTitleBarOverlayFromTheme).toHaveBeenCalledWith('dark');
    expect(mocks.setMainLanguage).toHaveBeenCalledWith('en', 'zh-CN');
    expect(mocks.broadcastSettingChanged).toHaveBeenCalledWith('theme', 'dark');
    expect(mocks.broadcastSettingChanged).toHaveBeenCalledWith('language', 'en');
  });

  it('含 proxy 时先脱敏再应用，proxy 分支不再重复广播普通键', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/in.json'] });
    mocks.readJsonImportFile.mockResolvedValue(payload);
    mocks.validateSettingsImport.mockReturnValue({
      imported: 2,
      skipped: 0,
      applied: [
        { key: 'proxy', value: { mode: 'fixed' } },
        { key: 'theme', value: 'dark' },
      ],
    });
    mocks.sanitizeProxySetting.mockResolvedValue({ mode: 'fixed', url: 'http://127.0.0.1:7890' });
    mocks.replaceSettingInImportPayload.mockReturnValue({ ...payload, replaced: true });
    mocks.applySettingsImport.mockReturnValue({
      imported: 2,
      skipped: 0,
      applied: [
        { key: 'proxy', value: { mode: 'fixed', url: 'http://127.0.0.1:7890' } },
        { key: 'theme', value: 'dark' },
      ],
    });
    mocks.enrichProxySetting.mockResolvedValue({ mode: 'fixed', hasAuth: true });

    await settingsHandlers.importSettings(undefined, ctx);

    expect(mocks.replaceSettingInImportPayload).toHaveBeenCalledWith(payload, 'proxy', {
      mode: 'fixed',
      url: 'http://127.0.0.1:7890',
    });
    expect(mocks.applyProxySetting).toHaveBeenCalledWith({
      mode: 'fixed',
      url: 'http://127.0.0.1:7890',
    });
    expect(mocks.broadcastSettingChanged).toHaveBeenCalledWith('proxy', {
      mode: 'fixed',
      hasAuth: true,
    });
    expect(mocks.broadcastSettingChanged).toHaveBeenCalledWith('theme', 'dark');
  });
});

describe('settingsHandlers.resetAll', () => {
  it('清空白名单键、凭据并重放默认副作用', async () => {
    await expect(settingsHandlers.resetAll({}, ctx)).resolves.toEqual({ settings: {} });

    expect(mocks.clearProxyAuthCredentials).toHaveBeenCalledOnce();
    expect(mocks.deleteSettings).toHaveBeenCalledWith(SETTING_KEYS);
    expect(mocks.syncTitleBarOverlayFromTheme).toHaveBeenCalledWith(undefined);
    expect(mocks.setMainLanguage).toHaveBeenCalledWith(undefined, 'zh-CN');
    expect(mocks.applyLogLevel).toHaveBeenCalledWith(false);
    expect(mocks.applyProxySetting).toHaveBeenCalledWith(undefined);
  });
});

describe('settingsHandlers telemetry level', () => {
  it('读取与写入遥测级别', async () => {
    mocks.readTelemetryLevelSync.mockReturnValue('off');
    await expect(settingsHandlers.getTelemetryLevel(undefined, ctx)).resolves.toEqual({
      level: 'off',
    });

    mocks.writeTelemetryLevel.mockResolvedValue(undefined);
    await expect(settingsHandlers.setTelemetryLevel({ level: 'full' }, ctx)).resolves.toEqual({
      ok: true,
      level: 'full',
    });
    expect(mocks.writeTelemetryLevel).toHaveBeenCalledWith('full');
  });
});
