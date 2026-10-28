import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSpy = vi.fn(async () => ({ data: { ok: true } }));
Object.defineProperty(window, 'api', {
  value: { settings: { set: setSpy } },
  writable: true,
  configurable: true,
});

import { applySettingsSnapshot, flushPendingSettings, useSettingsStore } from './settings-store';

/** store 的初始默认值（DEFAULT_SETTINGS 为模块私有；此处按已知默认态复位） */
const DEFAULTS = {
  theme: 'system',
  language: 'system',
  closeAction: 'minimize',
} as const;

describe('settings-store.applyMainSettingChange', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { settings: { set: setSpy } },
      writable: true,
      configurable: true,
    });
    setSpy.mockClear();
    useSettingsStore.setState({
      theme: DEFAULTS.theme,
      language: DEFAULTS.language,
      window: {
        closeAction: DEFAULTS.closeAction,
      },
    });
  });

  it('window 域：应用主进程传入的 closeAction', () => {
    useSettingsStore.getState().applyMainSettingChange('window', { closeAction: 'quit' });
    expect(useSettingsStore.getState().window.closeAction).toBe('quit');
  });

  it('不回写：不调用 settings:set（变更来源是主进程，回写是回声）', () => {
    useSettingsStore.getState().applyMainSettingChange('window', { closeAction: 'quit' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('按域合并：其它域不受影响（整体替换会打回默认值——这是不能复用 applySettingsSnapshot 的原因）', () => {
    useSettingsStore.setState({ theme: 'light', language: 'en' });

    useSettingsStore.getState().applyMainSettingChange('window', { closeAction: 'quit' });

    expect(useSettingsStore.getState().theme).toBe('light');
    expect(useSettingsStore.getState().language).toBe('en');
    expect(useSettingsStore.getState().window.closeAction).toBe('quit');
  });

  it('window 域只接受 closeAction：未知字段不进入 state', () => {
    useSettingsStore.setState({ window: { closeAction: 'minimize' } });

    useSettingsStore
      .getState()
      .applyMainSettingChange('window', { closeAction: 'quit', futureField: 'x' });

    expect(useSettingsStore.getState().window).toEqual({ closeAction: 'quit' });
  });

  it('非对象值被忽略（不让主进程的异常 payload 污染 state）', () => {
    const before = useSettingsStore.getState().window;

    useSettingsStore.getState().applyMainSettingChange('window', 'not-an-object');
    useSettingsStore.getState().applyMainSettingChange('window', null);

    expect(useSettingsStore.getState().window).toEqual(before);
  });

  it('未知/非对象域被忽略，不抛错也不新增键', () => {
    const before = useSettingsStore.getState();

    useSettingsStore.getState().applyMainSettingChange('theme', { bogus: 1 });
    expect(useSettingsStore.getState().theme).toBe(before.theme);
  });

  it('theme primitive：应用合法值且不回写（此前被 typeof value !== object 丢弃）', () => {
    useSettingsStore.getState().applyMainSettingChange('theme', 'light');
    expect(useSettingsStore.getState().theme).toBe('light');
    useSettingsStore.getState().applyMainSettingChange('theme', 'system');
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('theme 非法值忽略', () => {
    useSettingsStore.getState().applyMainSettingChange('theme', 'neon');
    useSettingsStore.getState().applyMainSettingChange('theme', 123);
    expect(useSettingsStore.getState().theme).toBe(DEFAULTS.theme);
  });

  it('language primitive：应用合法值且不回写', () => {
    useSettingsStore.getState().applyMainSettingChange('language', 'en');
    expect(useSettingsStore.getState().language).toBe('en');
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe('settings-store.persist 失败重试', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { settings: { set: setSpy } },
      writable: true,
      configurable: true,
    });
    setSpy.mockReset();
    setSpy.mockResolvedValue({ data: { ok: true } });
    useSettingsStore.setState({ theme: 'dark' });
  });

  it('写失败后 flushPendingSettings 会重试同键（内存与 SQLite 不永久分叉）', async () => {
    setSpy.mockRejectedValueOnce(new Error('db locked'));
    useSettingsStore.getState().setTheme('light');
    await flushPendingSettings();
    await flushPendingSettings();
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    const themeWrites = calls.filter((c) => c[0]?.key === 'theme');
    expect(themeWrites.length).toBeGreaterThanOrEqual(2);
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('写成功不进入重试账', async () => {
    useSettingsStore.getState().setTheme('dark');
    await flushPendingSettings();
    await flushPendingSettings();
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    const themeWrites = calls.filter((c) => c[0]?.key === 'theme');
    expect(themeWrites.length).toBe(1);
  });
});

describe('settings-store.notification 域', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { settings: { set: setSpy } },
      writable: true,
      configurable: true,
    });
    setSpy.mockReset();
    setSpy.mockResolvedValue({ data: { ok: true } });
  });

  it('updateNotification：部分字段合并 + 以 notification 键写穿透', () => {
    useSettingsStore.getState().updateNotification({ enabled: false });
    const state = useSettingsStore.getState().notification;
    expect(state).toEqual({ enabled: false });
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    const writes = calls.filter((c) => c[0]?.key === 'notification');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toEqual({ key: 'notification', value: { enabled: false } });
  });

  it('快照缺失 notification 键 → 回落默认（开）', () => {
    useSettingsStore.setState({ notification: { enabled: false } });
    applySettingsSnapshot({});
    expect(useSettingsStore.getState().notification).toEqual({ enabled: true });
  });

  it('快照部分字段 → 与默认合并', () => {
    applySettingsSnapshot({ notification: { enabled: false } });
    expect(useSettingsStore.getState().notification).toEqual({ enabled: false });
  });

  it('applyMainChange(notification)：按域合并且不回写（导入广播回声防线，33 号 V8）', () => {
    useSettingsStore.getState().applyMainSettingChange('notification', { enabled: false });
    expect(useSettingsStore.getState().notification).toEqual({ enabled: false });
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    expect(calls.filter((c) => c[0]?.key === 'notification')).toHaveLength(0);
  });
});

describe('settings-store.snapshot 基础值容错', () => {
  it('损坏 theme/language 回落默认，不让非法值进入主题循环或 i18n', () => {
    applySettingsSnapshot({ theme: 'neon', language: 'fr-FR' });
    expect(useSettingsStore.getState().theme).toBe(DEFAULTS.theme);
    expect(useSettingsStore.getState().language).toBe(DEFAULTS.language);
  });

  it('合法 theme/language 正常应用', () => {
    applySettingsSnapshot({ theme: 'system', language: 'en' });
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(useSettingsStore.getState().language).toBe('en');
  });
});

describe('settings-store.proxy 域（34 号网络代理）', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { settings: { set: setSpy } },
      writable: true,
      configurable: true,
    });
    setSpy.mockReset();
    setSpy.mockResolvedValue({ data: { ok: true } });
    useSettingsStore.setState({ proxy: { mode: 'system' } });
  });

  it('updateProxy：fixed 部分合并 + 以 proxy 键写穿透', () => {
    useSettingsStore.getState().updateProxy({
      mode: 'fixed',
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
    expect(useSettingsStore.getState().proxy).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    const writes = calls.filter((c) => c[0]?.key === 'proxy');
    expect(writes).toHaveLength(1);
  });

  it('updateProxy：auth 只随本次写入，不留在 store', () => {
    useSettingsStore.getState().updateProxy({
      mode: 'fixed',
      protocol: 'http',
      host: 'p',
      port: 8080,
      auth: { username: 'alice', password: 's3cret' },
    });
    expect(useSettingsStore.getState().proxy).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: 'p',
      port: 8080,
    });
    const calls = setSpy.mock.calls as unknown as { key: string; value: unknown }[][];
    const write = calls.find((c) => c[0]?.key === 'proxy');
    expect(write?.[0]?.value).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: 'p',
      port: 8080,
      auth: { username: 'alice', password: 's3cret' },
    });
  });

  it('模式从 fixed 切回 system → 代理字段清除（非 fixed 域不携带代理数据）', () => {
    useSettingsStore.getState().updateProxy({
      mode: 'fixed',
      protocol: 'socks5',
      host: 'p',
      port: 1080,
      bypass: ['corp.example'],
    });
    useSettingsStore.getState().updateProxy({ mode: 'system' });
    expect(useSettingsStore.getState().proxy).toEqual({ mode: 'system' });
  });

  it('快照缺 proxy 键 → 回落 system（V1/V6 渲染半）', () => {
    useSettingsStore.getState().updateProxy({
      mode: 'fixed',
      protocol: 'http',
      host: 'p',
      port: 1,
    });
    applySettingsSnapshot({});
    expect(useSettingsStore.getState().proxy).toEqual({ mode: 'system' });
  });

  it('applyMainChange(proxy)：按域合并且不回写（导入广播回声防线，V8）', () => {
    useSettingsStore.getState().applyMainSettingChange('proxy', {
      mode: 'fixed',
      protocol: 'http',
      host: '10.0.0.1',
      port: 8080,
    });
    expect(useSettingsStore.getState().proxy).toEqual({
      mode: 'fixed',
      protocol: 'http',
      host: '10.0.0.1',
      port: 8080,
    });
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    expect(calls.filter((c) => c[0]?.key === 'proxy')).toHaveLength(0);
  });
});

describe('settings-store.appearance 域（35 号界面缩放）', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { settings: { set: setSpy } },
      writable: true,
      configurable: true,
    });
    setSpy.mockReset();
    setSpy.mockResolvedValue({ data: { ok: true } });
    useSettingsStore.setState({ appearance: { zoom: 1 } });
  });

  it('updateAppearance：部分合并 + 以 appearance 键写穿透', () => {
    useSettingsStore.getState().updateAppearance({ zoom: 1.25 });
    expect(useSettingsStore.getState().appearance).toEqual({ zoom: 1.25 });
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    const writes = calls.filter((c) => c[0]?.key === 'appearance');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toEqual({ key: 'appearance', value: { zoom: 1.25 } });
  });

  it('V1 快照缺失 → 回落 1；V1 损坏值 → clampZoom 最近档位归一（CP2 fail-5）', () => {
    useSettingsStore.getState().updateAppearance({ zoom: 2 });
    applySettingsSnapshot({});
    expect(useSettingsStore.getState().appearance).toEqual({ zoom: 1 });

    applySettingsSnapshot({ appearance: { zoom: 0.93 } });
    expect(useSettingsStore.getState().appearance).toEqual({ zoom: 0.9 });

    applySettingsSnapshot({ appearance: { zoom: 'junk' } });
    expect(useSettingsStore.getState().appearance).toEqual({ zoom: 1 });
  });

  it('V6 导入回显：applyMainChange 通用分支按域合并且不回写', () => {
    useSettingsStore.getState().applyMainSettingChange('appearance', { zoom: 1.5 });
    expect(useSettingsStore.getState().appearance).toEqual({ zoom: 1.5 });
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    expect(calls.filter((c) => c[0]?.key === 'appearance')).toHaveLength(0);
  });
});

describe('settings-store 新增设置域', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { settings: { set: setSpy } },
      writable: true,
      configurable: true,
    });
    setSpy.mockReset();
    setSpy.mockResolvedValue({ data: { ok: true } });
    applySettingsSnapshot({});
  });

  it('快照缺 logging/backup → 回落默认（详细日志关 / 自动备份开 + 保留 3 份）', () => {
    expect(useSettingsStore.getState().logging).toEqual({ verbose: false });
    expect(useSettingsStore.getState().backup).toEqual({ autoBackup: true, keep: 3 });
  });

  it('快照部分字段与默认合并，非法 keep 不进入状态', () => {
    applySettingsSnapshot({ logging: { verbose: true }, backup: { keep: 5 } });
    expect(useSettingsStore.getState().logging).toEqual({ verbose: true });
    expect(useSettingsStore.getState().backup).toEqual({ autoBackup: true, keep: 5 });
  });

  it('updateLogging/updateBackup：部分合并并以对应键写穿透', () => {
    useSettingsStore.getState().updateLogging({ verbose: true });
    useSettingsStore.getState().updateBackup({ keep: 10 });
    const calls = setSpy.mock.calls as unknown as { key: string }[][];
    const writes = calls.map((c) => c[0]);
    expect(writes).toContainEqual({ key: 'logging', value: { verbose: true } });
    expect(writes).toContainEqual({ key: 'backup', value: { autoBackup: true, keep: 10 } });
  });

  it('update 域：autoCheck 与既有字段合并', () => {
    useSettingsStore.getState().setUpdate({ autoCheck: false });
    expect(useSettingsStore.getState().update).toMatchObject({
      autoCheck: false,
      allowPrerelease: false,
    });
  });

  it('language=system 是合法快照值，主进程导入广播可按域合并', () => {
    applySettingsSnapshot({ language: 'system' });
    expect(useSettingsStore.getState().language).toBe('system');
    useSettingsStore.getState().applyMainSettingChange('language', 'en');
    expect(useSettingsStore.getState().language).toBe('en');
  });
});
