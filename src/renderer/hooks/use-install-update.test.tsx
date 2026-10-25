import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

vi.mock('@/stores/transient/confirm-dialog-store', () => ({
  confirm: mocks.confirm,
}));

import { useInstallUpdate } from './use-install-update';

describe('useInstallUpdate', () => {
  beforeEach(() => {
    mocks.confirm.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('用户取消确认：不调用 update.install', async () => {
    const install = vi.spyOn(window.api.update, 'install');
    mocks.confirm.mockResolvedValue(false);
    const { result } = renderHook(() => useInstallUpdate());

    await act(async () => {
      await result.current();
    });

    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });

  it('用户确认：调用 update.install', async () => {
    const install = vi.spyOn(window.api.update, 'install');
    mocks.confirm.mockResolvedValue(true);
    const { result } = renderHook(() => useInstallUpdate());

    await act(async () => {
      await result.current();
    });

    expect(install).toHaveBeenCalledOnce();
  });

  it('无 preload 桥：确认后安全返回，不抛错', async () => {
    const original = window.api;
    Object.defineProperty(window, 'api', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    mocks.confirm.mockResolvedValue(true);
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
