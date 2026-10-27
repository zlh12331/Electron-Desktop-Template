import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppInfo } from './use-app-info';

const INFO = {
  version: '1.2.3',
  electron: '45.0.0',
  node: '26.12.1',
  chrome: '140.0.0',
  platform: 'win32',
  arch: 'x64',
  userDataPath: 'C:/data',
} as const;

describe('useAppInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'api', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it('成功：解包 app:getInfo 并更新状态', async () => {
    const getInfo = vi.fn(async () => ({ data: INFO }));
    Object.defineProperty(window, 'api', {
      value: { app: { getInfo } },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useAppInfo());

    await waitFor(() => expect(result.current).toEqual(INFO));
    expect(getInfo).toHaveBeenCalledOnce();
  });

  it('IPC error：返回 null 并回调 onError', async () => {
    const getInfo = vi.fn(async () => ({ error: { code: 'INTERNAL_ERROR', message: 'failed' } }));
    Object.defineProperty(window, 'api', {
      value: { app: { getInfo } },
      writable: true,
      configurable: true,
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useAppInfo(onError));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(result.current).toBeNull();
  });

  it('无 preload 桥：返回 browser 占位信息', async () => {
    Object.defineProperty(window, 'api', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useAppInfo());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toMatchObject({ version: 'dev', platform: 'browser' });
  });
});
