import { ZOOM_LEVELS } from '@code-agent/shared/renderer';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { useSettingsStore } from '@/stores/persistent/settings-store';

import { ZoomSection } from './zoom-section';

const t = i18n.t.bind(i18n);
const setSpy = vi.fn(async () => ({ data: { ok: true } }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: { settings: { set: setSpy } },
    writable: true,
    configurable: true,
  });
  useSettingsStore.setState({ appearance: { zoom: 1 }, theme: 'system' });
});

describe('ZoomSection', () => {
  it('主题默认跟随系统：下拉回显 system', () => {
    render(<ZoomSection />);

    expect(screen.getByText(t('settings.themeTitle'))).toBeDefined();
    expect(screen.getByRole('combobox', { name: t('settings.themeTitle') })).toHaveTextContent(
      t('settings.themeSystem'),
    );
  });

  it('主题下拉切换到深色 → 写入 settings-store', async () => {
    const user = userEvent.setup();
    render(<ZoomSection />);

    await user.click(screen.getByRole('combobox', { name: t('settings.themeTitle') }));
    await user.click(await screen.findByRole('option', { name: t('settings.themeDark') }));

    expect(useSettingsStore.getState().theme).toBe('dark');
    await waitFor(() => {
      const calls = setSpy.mock.calls as unknown as { key: string }[][];
      expect(calls.filter((c) => c[0]?.key === 'theme')).toHaveLength(1);
    });
  });

  it('渲染标题与当前档位回显（100%）', () => {
    render(<ZoomSection />);
    expect(screen.getByText(t('settings.zoomTitle'))).toBeDefined();
    expect(screen.getByText(t('settings.zoomPercent', { percent: 100 }))).toBeDefined();
  });

  it('当前档位 125% → 触发器回显 125%（store 单真源）', () => {
    useSettingsStore.setState({ appearance: { zoom: 1.25 } });
    render(<ZoomSection />);
    expect(screen.getByText(t('settings.zoomPercent', { percent: 125 }))).toBeDefined();
  });

  it('档位表与 ZOOM_LEVELS 单一真源一致（11 档）', () => {
    expect(ZOOM_LEVELS).toHaveLength(11);
    const values = ZOOM_LEVELS.map((l) => String(l));
    expect(new Set(values).size).toBe(11);
  });

  it('updateAppearance 写穿透以 appearance 键落库（V2 写半）', async () => {
    useSettingsStore.getState().updateAppearance({ zoom: 1.5 });
    await waitFor(() => {
      const calls = setSpy.mock.calls as unknown as { key: string }[][];
      expect(calls.filter((c) => c[0]?.key === 'appearance')).toHaveLength(1);
    });
    expect(useSettingsStore.getState().appearance.zoom).toBe(1.5);
  });
});
