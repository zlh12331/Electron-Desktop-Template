import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { useSettingsStore } from '@/stores/persistent/settings-store';

import { GeneralSection } from './general-section';

const t = i18n.t.bind(i18n);

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    language: 'system',
    window: { closeAction: 'minimize' },
  });
  Object.defineProperty(window, 'api', {
    value: {
      settings: { set: vi.fn(async () => ({ data: { ok: true } })) },
      app: {
        getLoginItemSettings: vi.fn(async () => ({
          data: { openAtLogin: false, supported: true, requiresApproval: false },
        })),
        setLoginItemSettings: vi.fn(),
        subscribeLoginItemChanged: vi.fn(() => () => {}),
      },
    },
    writable: true,
    configurable: true,
  });
});

describe('GeneralSection', () => {
  it('正向：只渲染通用职责，不重复挂载通知/外观/数据分区', () => {
    renderWithQuery(<GeneralSection />);

    expect(screen.getByText(t('settings.language'))).toBeDefined();
    expect(screen.getByText(t('settings.telemetryTitle'))).toBeDefined();
    expect(screen.queryByText(t('settings.dataSection'))).toBeNull();
    expect(screen.queryByText(t('settings.zoomTitle'))).toBeNull();
    expect(screen.queryByText(t('settings.notificationTitle'))).toBeNull();
  });

  it('默认跟随系统：下拉回显 system', () => {
    renderWithQuery(<GeneralSection />);

    expect(screen.getByRole('combobox', { name: t('settings.language') })).toHaveTextContent(
      t('settings.languageSystem'),
    );
  });

  it('下拉切换到 English → 写入 settings-store（SQLite 写穿透真源）', async () => {
    const user = userEvent.setup();
    renderWithQuery(<GeneralSection />);

    await user.click(screen.getByRole('combobox', { name: t('settings.language') }));
    await user.click(await screen.findByRole('option', { name: /English/ }));

    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('下拉切回跟随系统 → language=system', async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ language: 'zh-CN' });
    renderWithQuery(<GeneralSection />);

    await user.click(screen.getByRole('combobox', { name: t('settings.language') }));
    await user.click(
      await screen.findByRole('option', { name: new RegExp(t('settings.languageSystem')) }),
    );

    expect(useSettingsStore.getState().language).toBe('system');
  });
});
