import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInstallUpdate } from './use-install-update';

describe('useInstallUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('点击后直接调用 update.install，不弹确认框', async () => {
    const install = vi.spyOn(window.api.update, 'install');
    const { result } = renderHook(() => useInstallUpdate());

    await act(async () => {
      await result.current();
    });

    expect(install).toHaveBeenCalledOnce();
  });

  it('无 preload 桥：安全返回，不抛错', async () => {
    const original = window.api;
    Object.defineProperty(window, 'api', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useInstallUpdate());

    try {
      await act(async () => {
        await result.current();
      });
    } finally {
      Object.defineProperty(window, 'api', {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });
});
