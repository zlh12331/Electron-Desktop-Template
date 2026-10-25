import type { DeepLinkPayload } from '@code-agent/shared/renderer';
import { act, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeepLink } from './use-deep-link';

function Probe(): null {
  useDeepLink();
  return null;
}

const originalSubscribe = window.api.app.subscribeDeepLink;
const originalTake = window.api.app.takePendingDeepLink;

function renderAtHome(): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter([
    { path: '/', element: <Probe /> },
    { path: '/about', element: <div>about</div> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe('useDeepLink', () => {
  beforeEach(() => {
    window.api.app.takePendingDeepLink = vi.fn(async () => ({ data: { payload: null } }));
  });

  afterEach(() => {
    window.api.app.subscribeDeepLink = originalSubscribe;
    window.api.app.takePendingDeepLink = originalTake;
  });

  it('收到有效事件后导航到示例目标', async () => {
    let listener: ((payload: DeepLinkPayload) => void) | null = null;
    const unsubscribe = vi.fn();
    window.api.app.subscribeDeepLink = (callback) => {
      listener = callback;
      return unsubscribe;
    };

    const router = renderAtHome();
    await waitFor(() => expect(listener).not.toBeNull());
    act(() => {
      listener?.({ targetId: 'abc', url: 'electron-template://open/abc' });
    });

    expect(router.state.location.pathname).toBe('/about');
  });

  it('冷启动暂存值在挂载后消费一次', async () => {
    window.api.app.subscribeDeepLink = () => () => {};
    window.api.app.takePendingDeepLink = vi.fn(async () => ({
      data: { payload: { targetId: 'cold', url: 'electron-template://open/cold' } },
    }));

    const router = renderAtHome();
    await waitFor(() => expect(router.state.location.pathname).toBe('/about'));
  });

  it('仅唤起（targetId=null）不导航', async () => {
    let listener: ((payload: DeepLinkPayload) => void) | null = null;
    window.api.app.subscribeDeepLink = (callback) => {
      listener = callback;
      return vi.fn();
    };

    const router = renderAtHome();
    await waitFor(() => expect(listener).not.toBeNull());
    act(() => {
      listener?.({ targetId: null, url: 'electron-template://open' });
    });

    expect(router.state.location.pathname).toBe('/');
  });
});
