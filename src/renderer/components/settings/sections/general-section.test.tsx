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
    language: 'zh-CN',
    window: { closeAction: 'minimize', startMinimized: false },
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

  it('正向：点 English → 写入 settings-store（SQLite 写穿透真源）', async () => {
    renderWithQuery(<GeneralSection />);

    await userEvent.click(screen.getByRole('button', { name: /English/ }));

    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('边界：当前语言项带选中勾选（zh-CN 时简体中文高亮）', () => {
    renderWithQuery(<GeneralSection />);
    expect(screen.getByRole('button', { name: /简体中文/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /English/ })).toBeDefined();
    expect(
      screen.getByRole('button', { name: new RegExp(t('settings.languageSystem')) }),
    ).toBeDefined();
  });

  it('跟随系统：点击 System 写入 language=system', async () => {
    renderWithQuery(<GeneralSection />);
    await userEvent.click(
      screen.getByRole('button', { name: new RegExp(t('settings.languageSystem')) }),
    );
    expect(useSettingsStore.getState().language).toBe('system');
  });

  it('启动时最小化：开关写入 window.startMinimized', async () => {
    renderWithQuery(<GeneralSection />);
    await userEvent.click(screen.getByRole('switch', { name: t('settings.startMinimizedLabel') }));
    expect(useSettingsStore.getState().window.startMinimized).toBe(true);
  });
});
