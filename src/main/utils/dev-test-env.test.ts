import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDevRendererUrl,
  isDevTestEnvEnabled,
  readDevTestEnv,
  resolveEnvFileToLoad,
} from './dev-test-env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readDevTestEnv', () => {
  it('dev 读取变量，打包态一律 undefined', () => {
    vi.stubEnv('APP_SKIP_CLOSE_GUARD', '1');
    expect(readDevTestEnv(false, 'APP_SKIP_CLOSE_GUARD')).toBe('1');
    expect(readDevTestEnv(true, 'APP_SKIP_CLOSE_GUARD')).toBeUndefined();
  });
});

describe('isDevTestEnvEnabled', () => {
  it('仅 dev + 值为 1 时开启', () => {
    vi.stubEnv('APP_DEV_UPDATE', '1');
    expect(isDevTestEnvEnabled(false, 'APP_DEV_UPDATE')).toBe(true);
    expect(isDevTestEnvEnabled(true, 'APP_DEV_UPDATE')).toBe(false);
  });

  it('非 1 值与未设置均关闭', () => {
    vi.stubEnv('APP_DEV_UPDATE', 'true');
    expect(isDevTestEnvEnabled(false, 'APP_DEV_UPDATE')).toBe(false);
    vi.unstubAllEnvs();
    expect(isDevTestEnvEnabled(false, 'APP_DEV_UPDATE')).toBe(false);
  });
});

describe('getDevRendererUrl', () => {
  it('dev 返回 URL，打包态为 undefined', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
    expect(getDevRendererUrl(false)).toBe('http://localhost:5173');
    expect(getDevRendererUrl(true)).toBeUndefined();
  });

  it('未配置时返回 undefined', () => {
    expect(getDevRendererUrl(false)).toBeUndefined();
  });
});

describe('resolveEnvFileToLoad', () => {
  const base = {
    isPackaged: false,
    nodeEnv: 'development',
    envFile: undefined,
    defaultPath: 'C:/repo/.env',
  } as const;

  it('dev 默认加载默认路径，显式路径优先', () => {
    expect(resolveEnvFileToLoad(base)).toBe('C:/repo/.env');
    expect(resolveEnvFileToLoad({ ...base, envFile: 'C:/tmp/test.env' })).toBe('C:/tmp/test.env');
  });

  it('打包态、NODE_ENV=test、显式空串均不加载', () => {
    expect(resolveEnvFileToLoad({ ...base, isPackaged: true })).toBeNull();
    expect(resolveEnvFileToLoad({ ...base, nodeEnv: 'test' })).toBeNull();
    expect(resolveEnvFileToLoad({ ...base, envFile: '' })).toBeNull();
  });
});
