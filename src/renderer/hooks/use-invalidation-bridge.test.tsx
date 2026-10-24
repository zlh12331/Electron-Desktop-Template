import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyDomainInvalidation: vi.fn(),
}));

vi.mock('@/lib/invalidation/invalidation', () => ({
  applyDomainInvalidation: mocks.applyDomainInvalidation,
}));

import { useInvalidationBridge } from './use-invalidation-bridge';

const originalSubscribe = window.api.invalidation.subscribeDomains;

describe('useInvalidationBridge', () => {
  afterEach(() => {
    window.api.invalidation.subscribeDomains = originalSubscribe;
  });

  it('收到失效域事件后交给失效器，并在卸载时退订', async () => {
    let listener: ((payload: { domains: readonly string[] }) => void) | null = null;
    const unsubscribe = vi.fn();
    window.api.invalidation.subscribeDomains = (callback) => {
      listener = callback;
      return unsubscribe;
    };

    const { unmount } = renderHook(() => useInvalidationBridge());
    await waitFor(() => expect(listener).not.toBeNull());

    act(() => {
      listener?.({ domains: ['settings'] });
    });
    expect(mocks.applyDomainInvalidation).toHaveBeenCalledWith(['settings']);

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
