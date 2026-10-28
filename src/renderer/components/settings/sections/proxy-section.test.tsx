import type { ProxyDetectSystemRes } from '@code-agent/shared/renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { useSettingsStore } from '@/stores/persistent/settings-store';

import { ProxySection } from './proxy-section';

const t = i18n.t.bind(i18n);

const setSpy = vi.fn(async () => ({ data: { ok: true } }));
const testSpy = vi.fn(async () => ({
  data: { ok: true, kind: 'ok', latencyMs: 42 },
}));
const detectSystemSpy = vi.fn<() => Promise<{ data: ProxyDetectSystemRes }>>(async () => ({
  data: { detected: false },
}));
const clearAuthSpy = vi.fn(async () => ({ data: { ok: true } }));

function renderSection(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProxySection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: {
      settings: { set: setSpy },
      proxy: {
        test: testSpy,
        detectSystem: detectSystemSpy,
        clearAuth: clearAuthSpy,
      },
    },
    writable: true,
    configurable: true,
  });
  useSettingsStore.setState({ proxy: { mode: 'system' } });
});

describe('ProxySection', () => {
  it('system 模式：三选项 + 系统代理检测卡片，fixed 区块不显示', async () => {
    renderSection();

    expect(screen.getByText(t('settings.proxyModeSystem'))).toBeDefined();
    expect(screen.queryByLabelText(t('settings.proxyHostLabel'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('settings.proxyTestButton') })).toBeNull();
    await waitFor(() => expect(detectSystemSpy).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText(t('settings.proxySystemNotDetected'))).toBeDefined();
    });
  });

  it('切换到 fixed → 协议/主机/端口/认证/绕过/测试展开', async () => {
    renderSection();
    await userEvent.click(screen.getByText(t('settings.proxyModeFixed')));

    expect(screen.getByLabelText(t('settings.proxyProtocolLabel'))).toBeDefined();
    expect(screen.getByLabelText(t('settings.proxyHostLabel'))).toBeDefined();
    expect(screen.getByLabelText(t('settings.proxyPortLabel'))).toBeDefined();
    expect(screen.getByLabelText(t('settings.proxyAuthLabel'))).toBeDefined();
    expect(screen.getByLabelText(t('settings.proxyBypassLabel'))).toBeDefined();
    expect(screen.getByRole('button', { name: t('settings.proxyTestButton') })).toBeDefined();
  });

  it('合法主机/端口 → 防抖写穿透结构化 proxy', async () => {
    useSettingsStore.setState({
      proxy: { mode: 'fixed', protocol: 'http', host: '' },
    });
    renderSection();

    await userEvent.type(screen.getByLabelText(t('settings.proxyHostLabel')), '127.0.0.1');
    await userEvent.type(screen.getByLabelText(t('settings.proxyPortLabel')), '7890');

    await waitFor(
      () => {
        expect(useSettingsStore.getState().proxy).toEqual({
          mode: 'fixed',
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          bypass: [],
        });
      },
      { timeout: 1_500 },
    );
  });

  it('非法主机 → 行内错误且测试按钮禁用', async () => {
    useSettingsStore.setState({
      proxy: { mode: 'fixed', protocol: 'http', host: '', port: 7890 },
    });
    renderSection();

    await userEvent.type(screen.getByLabelText(t('settings.proxyHostLabel')), 'http://bad');
    await userEvent.tab();

    await waitFor(() => {
      expect(screen.getByText(t('settings.proxyHostInvalid'))).toBeDefined();
    });
    expect(screen.getByRole('button', { name: t('settings.proxyTestButton') })).toBeDisabled();
  });

  it('测试连接：使用草稿配置并显示耗时', async () => {
    useSettingsStore.setState({
      proxy: { mode: 'fixed', protocol: 'http', host: '127.0.0.1', port: 7890 },
    });
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.proxyTestButton') }));

    await waitFor(() => {
      expect(screen.getByText(t('settings.proxyTestSuccess', { ms: 42 }))).toBeDefined();
    });
    expect(testSpy).toHaveBeenCalledWith({
      config: {
        mode: 'fixed',
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
        bypass: [],
      },
    });
  });

  it('测试归因：代理不可达显示对应文案', async () => {
    testSpy.mockResolvedValueOnce({ data: { ok: false, kind: 'proxy-unreachable', latencyMs: 0 } });
    useSettingsStore.setState({
      proxy: { mode: 'fixed', protocol: 'http', host: '127.0.0.1', port: 7890 },
    });
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.proxyTestButton') }));

    await waitFor(() => {
      expect(screen.getByText(t('settings.proxyTestProxyUnreachable'))).toBeDefined();
    });
  });

  it('认证：开启后填写用户名/密码，测试草稿携带凭据', async () => {
    useSettingsStore.setState({
      proxy: { mode: 'fixed', protocol: 'http', host: '127.0.0.1', port: 7890 },
    });
    renderSection();

    await userEvent.click(screen.getByLabelText(t('settings.proxyAuthLabel')));
    await userEvent.type(screen.getByLabelText(t('settings.proxyAuthUsername')), 'alice');
    await userEvent.type(screen.getByLabelText(t('settings.proxyAuthPassword')), 's3cret');
    await userEvent.click(screen.getByRole('button', { name: t('settings.proxyTestButton') }));

    await waitFor(() => {
      expect(testSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            auth: { username: 'alice', password: 's3cret' },
          }),
        }),
      );
    });
  });

  it('SOCKS5：认证开关禁用并显示限制说明', async () => {
    useSettingsStore.setState({
      proxy: { mode: 'fixed', protocol: 'http', host: '127.0.0.1', port: 7890 },
    });
    renderSection();

    await userEvent.click(screen.getByRole('combobox', { name: t('settings.proxyProtocolLabel') }));
    await userEvent.click(screen.getByText(t('settings.proxyProtocolSocks5')));

    await waitFor(() => {
      expect(screen.getByText(t('settings.proxyAuthSocks5Unsupported'))).toBeDefined();
    });
    expect(screen.getByLabelText(t('settings.proxyAuthLabel'))).toBeDisabled();
  });

  it('已保存凭据：显示用户名与清除入口，清除调用 proxy:clearAuth', async () => {
    useSettingsStore.setState({
      proxy: {
        mode: 'fixed',
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
        hasAuth: true,
        authUsername: 'alice',
      },
    });
    renderSection();

    expect(screen.getByText(t('settings.proxyAuthSaved', { username: 'alice' }))).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: t('settings.proxyAuthClear') }));
    await waitFor(() => expect(clearAuthSpy).toHaveBeenCalledTimes(1));
  });

  it('从系统导入：填充协议/主机/端口并写穿透', async () => {
    detectSystemSpy.mockResolvedValue({
      data: { detected: true, protocol: 'socks5', host: '127.0.0.1', port: 1080 },
    });
    renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: t('settings.proxyImportFromSystem') }),
    );

    await waitFor(() => {
      expect(useSettingsStore.getState().proxy).toMatchObject({
        mode: 'fixed',
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      });
    });
  });
});
