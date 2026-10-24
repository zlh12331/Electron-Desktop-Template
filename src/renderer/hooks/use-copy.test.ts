import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: vi.fn(), warning: vi.fn() },
}));

import { useCopy } from './use-copy';

function setClipboard(value: { writeText: (text: string) => Promise<void> } | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('useCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('复制成功进入 2 秒反馈期，卸载时清理定时器', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { result, unmount } = renderHook(() => useCopy());

    await act(async () => {
      await result.current.copy('hello');
    });

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.copied).toBe(true);
    unmount();
  });

  it('剪贴板写入失败时提示而不是静默', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const { result } = renderHook(() => useCopy());

    await act(async () => {
      await result.current.copy('hello');
    });

    expect(mocks.error).toHaveBeenCalled();
    expect(result.current.copied).toBe(false);
  });

  it('无剪贴板 API 时提示', async () => {
    setClipboard(undefined);
    const { result } = renderHook(() => useCopy());

    await act(async () => {
      await result.current.copy('hello');
    });

    expect(mocks.error).toHaveBeenCalled();
  });
});
