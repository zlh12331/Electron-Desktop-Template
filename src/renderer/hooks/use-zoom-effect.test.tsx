import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyZoom: vi.fn(),
}));

vi.mock('@/lib/zoom', () => ({
  applyZoom: mocks.applyZoom,
}));

import { useSettingsStore } from '@/stores/persistent/settings-store';
import { useZoomEffect } from './use-zoom-effect';

describe('useZoomEffect', () => {
  afterEach(() => {
    act(() => {
      useSettingsStore.setState({ appearance: { zoom: 1 } });
    });
  });

  it('挂载时应用当前缩放档位', () => {
    act(() => {
      useSettingsStore.setState({ appearance: { zoom: 1.25 } });
    });
    renderHook(() => useZoomEffect());
    expect(mocks.applyZoom).toHaveBeenCalledWith(1.25);
  });
});
