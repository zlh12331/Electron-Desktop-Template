import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { useSettingsStore } from '@/stores/persistent/settings-store';

import { NotificationSection } from './notification-section';

const t = i18n.t.bind(i18n);

const setSpy = vi.fn(async () => ({ data: { ok: true } }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: { settings: { set: setSpy } },
    writable: true,
    configurable: true,
  });
  useSettingsStore.setState({ notification: { enabled: true } });
});

describe('NotificationSection', () => {
  it('默认态：总开关渲染且开启', () => {
    render(<NotificationSection />);

    const toggle = screen.getByRole('switch', { name: t('settings.notificationLabel') });
    expect(toggle).toBeDefined();
    expect(toggle).not.toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('关闭总开关 → store 更新 + 以 notification 键写穿透', async () => {
    render(<NotificationSection />);

    await userEvent.click(screen.getByRole('switch', { name: t('settings.notificationLabel') }));

    expect(useSettingsStore.getState().notification.enabled).toBe(false);
    const calls = setSpy.mock.calls as unknown as { key: string; value: unknown }[][];
    const writes = calls.filter((c) => c[0]?.key === 'notification');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]?.value).toEqual({ enabled: false });
  });
});
