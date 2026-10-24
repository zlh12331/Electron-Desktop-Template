import type { SettingsChangedPayload } from '@code-agent/shared/renderer';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/persistent/settings-store';
import { useSettingsBridge } from './use-settings-bridge';

const originalSubscribe = window.api.settings.subscribeChanged;

describe('useSettingsBridge', () => {
  afterEach(() => {
    window.api.settings.subscribeChanged = originalSubscribe;
    act(() => {
      useSettingsStore.setState({ theme: 'dark' });
    });
  });

  it('主进程设置变更事件只更新内存态', async () => {
    let listener: ((payload: SettingsChangedPayload) => void) | null = null;
    const unsubscribe = vi.fn();
    window.api.settings.subscribeChanged = (callback) => {
      listener = callback;
      return unsubscribe;
    };

    const { unmount } = renderHook(() => useSettingsBridge());
    await waitFor(() => expect(listener).not.toBeNull());

    act(() => {
      listener?.({ key: 'theme', value: 'light' });
    });

    expect(useSettingsStore.getState().theme).toBe('light');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
