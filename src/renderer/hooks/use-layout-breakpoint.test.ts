import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLayoutBreakpoint } from './use-layout-breakpoint';

type Listener = (event: MediaQueryListEvent) => void;

const originalMatchMedia = window.matchMedia;

function installMatchMedia(): {
  emit: (query: string, matches: boolean) => void;
  removeEventListener: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, Set<Listener>>();
  const removeEventListener = vi.fn((query: string, listener: Listener) => {
    listeners.get(query)?.delete(listener);
  });

  window.matchMedia = vi.fn((query: string) => {
    const set = listeners.get(query) ?? new Set<Listener>();
    listeners.set(query, set);
    return {
      matches: false,
      media: query,
      addEventListener: (_type: string, listener: Listener) => set.add(listener),
      removeEventListener: (_type: string, listener: Listener) => {
        set.delete(listener);
        removeEventListener(query, listener);
      },
    };
  }) as unknown as typeof window.matchMedia;

  return {
    emit: (query, matches) => {
      for (const listener of listeners.get(query) ?? []) {
        listener({ matches } as MediaQueryListEvent);
      }
    },
    removeEventListener,
  };
}

describe('useLayoutBreakpoint', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('初始读取两档断点，并在媒体查询变化时更新', () => {
    const media = installMatchMedia();
    const { result } = renderHook(() => useLayoutBreakpoint());

    expect(result.current).toEqual({ isCompact: false, isNarrow: false });

    act(() => {
      media.emit('(max-width: 1200px)', true);
      media.emit('(max-width: 900px)', true);
    });

    expect(result.current).toEqual({ isCompact: true, isNarrow: true });
  });

  it('卸载时移除两个监听器', () => {
    const media = installMatchMedia();
    const { unmount } = renderHook(() => useLayoutBreakpoint());
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
