import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeError: new Error('route boom'),
  reportError: vi.fn(),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useRouteError: () => mocks.routeError,
    ['Outlet']: () => <div data-testid="outlet" />,
  };
});

vi.mock('@/components/layout/AppShell', () => ({
  ['AppShell']: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock('@/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/error-report', () => ({
  reportError: mocks.reportError,
}));

import { RootErrorBoundary, RootHydrateFallback, RootLayout } from './root';

describe('RootLayout', () => {
  it('AppShell 包裹 Outlet', () => {
    const { getByTestId } = render(<RootLayout />);
    expect(getByTestId('app-shell')).toBeInTheDocument();
    expect(getByTestId('outlet')).toBeInTheDocument();
  });
});

describe('RootHydrateFallback', () => {
  it('渲染加载状态（role=status）', () => {
    const { getByRole } = render(<RootHydrateFallback />);
    expect(getByRole('status')).toBeInTheDocument();
  });
});

describe('RootErrorBoundary', () => {
  it('普通错误：渲染兜底并上报一次（StrictMode 双执行去重）', () => {
    render(
      <StrictMode>
        <RootErrorBoundary />
      </StrictMode>,
    );
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    expect(mocks.reportError).toHaveBeenCalledWith(mocks.routeError, {
      tags: { boundary: 'RootErrorBoundary' },
    });
  });
});
