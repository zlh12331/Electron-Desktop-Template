import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isBoundsVisible,
  loadWindowState,
  trackWindowState,
  type WindowState,
} from './window-state';

const WORK_AREAS = [{ x: 0, y: 0, width: 1920, height: 1040 }];

describe('isBoundsVisible', () => {
  it('中心点在工作区内 → 可见', () => {
    expect(isBoundsVisible({ x: 100, y: 100, width: 800, height: 600 }, WORK_AREAS)).toBe(true);
  });

  it('完全落在屏幕外（外接屏拔掉场景）→ 不可见', () => {
    expect(isBoundsVisible({ x: -1500, y: 100, width: 800, height: 600 }, WORK_AREAS)).toBe(false);
  });

  it('中心点在工作区外但窗口部分可见 → 不可见（严格判定防恢复出屏）', () => {
    expect(isBoundsVisible({ x: 1600, y: 100, width: 800, height: 600 }, WORK_AREAS)).toBe(false);
  });

  it('多显示器：中心点落在任一工作区即可', () => {
    const areas = [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 1920, y: 0, width: 1920, height: 1040 },
    ];
    expect(isBoundsVisible({ x: 2000, y: 100, width: 400, height: 300 }, areas)).toBe(true);
  });
});

describe('loadWindowState', () => {
  it('文件缺失（首次启动）→ 回退默认值', () => {
    const state = loadWindowState(
      join(tmpdir(), 'no-such-window-state.json'),
      { width: 1280, height: 800 },
      WORK_AREAS,
    );
    expect(state).toEqual({ width: 1280, height: 800, isMaximized: false });
  });

  it('有效状态 → 原样恢复（含坐标与最大化）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wstate-'));
    const file = join(dir, 'state.json');
    writeFileSync(
      file,
      JSON.stringify({ x: 200, y: 100, width: 1440, height: 900, isMaximized: true }),
      'utf8',
    );
    const state = loadWindowState(file, { width: 1280, height: 800 }, WORK_AREAS);
    expect(state).toEqual({ x: 200, y: 100, width: 1440, height: 900, isMaximized: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('坐标不可见（屏幕变动）→ 丢弃坐标保留尺寸', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wstate-'));
    const file = join(dir, 'state.json');
    writeFileSync(
      file,
      JSON.stringify({ x: -2000, y: 100, width: 1440, height: 900, isMaximized: false }),
      'utf8',
    );
    const state = loadWindowState(file, { width: 1280, height: 800 }, WORK_AREAS);
    expect(state).toEqual({ width: 1440, height: 900, isMaximized: false });
    rmSync(dir, { recursive: true, force: true });
  });

  it('JSON 损坏 → 回退默认值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wstate-'));
    const file = join(dir, 'state.json');
    writeFileSync(file, '{broken json', 'utf8');
    const state = loadWindowState(file, { width: 1280, height: 800 }, WORK_AREAS);
    expect(state).toEqual({ width: 1280, height: 800, isMaximized: false });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('trackWindowState', () => {
  it('close 同步兜底：关窗时立即落盘最新状态', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wstate-'));
    const file = join(dir, 'state.json');

    const listeners = new Map<string, () => void>();
    const bounds = { x: 10, y: 20, width: 900, height: 700 };
    let maximized = false;
    const fakeWin = {
      on: (event: string, fn: () => void): void => {
        listeners.set(event, fn);
      },
      removeListener: (event: string): void => {
        listeners.delete(event);
      },
      isDestroyed: (): boolean => false,
      getBounds: (): { x: number; y: number; width: number; height: number } => bounds,
      isMaximized: (): boolean => maximized,
    } as unknown as Parameters<typeof trackWindowState>[0];

    const cleanup = trackWindowState(fakeWin, file);
    listeners.get('close')?.();
    const state = JSON.parse(readFileSync(file, 'utf8')) as WindowState;
    expect(state).toEqual({ x: 10, y: 20, width: 900, height: 700, isMaximized: false });

    maximized = true;
    listeners.get('maximize')?.();
    const state2 = JSON.parse(readFileSync(file, 'utf8')) as WindowState;
    expect(state2.isMaximized).toBe(true);

    cleanup();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('边界与持久化守卫', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wstate-edge-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('部分字段非 number（width 为字符串）：回退默认值', () => {
    const file = join(dir, 'ws.json');
    writeFileSync(
      file,
      JSON.stringify({ width: '800', height: 600, x: 10, y: 20, isMaximized: true }),
      'utf8',
    );
    const state = loadWindowState(file, { width: 1024, height: 768 }, []);
    expect(state.width).toBe(1024);
    expect(state.height).toBe(600);
    expect(state.isMaximized).toBe(true);
  });

  it('x/y 非 number：视为缺失 → 坐标不可见回退（不含 x/y）', () => {
    const file = join(dir, 'ws2.json');
    writeFileSync(file, JSON.stringify({ width: 800, height: 600, x: '10', y: '20' }), 'utf8');
    const state = loadWindowState(file, { width: 1024, height: 768 }, []);
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
  });

  it('窗口已销毁：persist 守卫跳过（不写文件）', () => {
    const file = join(dir, 'ws3.json');
    const listeners = new Map<string, () => void>();
    const win = {
      isDestroyed: () => true,
      getBounds: () => ({ x: 10, y: 20, width: 800, height: 600 }),
      isMaximized: () => false,
      on: vi.fn((event: string, cb: () => void) => {
        listeners.set(event, cb);
      }),
      removeListener: vi.fn(),
    } as never;

    const cleanup = trackWindowState(win, file);
    listeners.get('close')?.();

    expect(existsSync(file)).toBe(false);
    cleanup();
  });

  it('bounds 缺 x/y：条件展开不写入 undefined', () => {
    const file = join(dir, 'ws4.json');
    const listeners = new Map<string, () => void>();
    const win = {
      isDestroyed: () => false,
      getBounds: () => ({ width: 800, height: 600 }),
      isMaximized: () => false,
      on: vi.fn((event: string, cb: () => void) => {
        listeners.set(event, cb);
      }),
      removeListener: vi.fn(),
    } as never;

    trackWindowState(win, file);
    listeners.get('close')?.();

    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(saved['x']).toBeUndefined();
    expect(saved['y']).toBeUndefined();
    expect(saved['width']).toBe(800);
  });

  it('防抖合并：连续 resize 只保存一次（clearTimeout 分支）', async () => {
    vi.useFakeTimers();
    const file = join(dir, 'ws5.json');
    const listeners = new Map<string, () => void>();
    const win = {
      isDestroyed: () => false,
      getBounds: () => ({ x: 10, y: 20, width: 800, height: 600 }),
      isMaximized: () => false,
      on: vi.fn((event: string, cb: () => void) => {
        listeners.set(event, cb);
      }),
      removeListener: vi.fn(),
    } as never;

    trackWindowState(win, file);
    const resize = listeners.get('resize');
    expect(resize).toBeDefined();
    resize?.();
    resize?.();
    resize?.();
    await vi.advanceTimersByTimeAsync(500);

    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(saved['width']).toBe(800);
  });
});
