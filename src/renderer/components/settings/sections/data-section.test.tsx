import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { useSettingsStore } from '@/stores/persistent/settings-store';
import { useUpdateStore } from '@/stores/transient/update-store';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  confirm: vi.fn(),
  getCache: vi.fn(),
  clearCache: vi.fn(),
  exportSettings: vi.fn(),
  importSettings: vi.fn(),
  resetAll: vi.fn(),
  openDataDir: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@/stores/transient/confirm-dialog-store', () => ({ confirm: mocks.confirm }));
vi.mock('@/lib/settings-ops', () => ({
  getUpdateCacheInfo: mocks.getCache,
  clearUpdateCache: mocks.clearCache,
  exportSettingsFile: mocks.exportSettings,
  importSettingsFile: mocks.importSettings,
  resetAllSettings: mocks.resetAll,
  openDataDirChecked: mocks.openDataDir,
}));
vi.mock('./backup-block', () => ({
  // biome-ignore lint/style/useNamingConvention: 被 mock 的组件导出名是 PascalCase
  BackupBlock: () => <div data-testid="backup-block" />,
}));

import { DataSection } from './data-section';

const t = i18n.t.bind(i18n);

function renderSection(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(
    <Wrapper>
      <DataSection />
    </Wrapper>,
  );
}

const CACHE = { path: 'C:/cache', bytes: 1024, fileCount: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.getCache.mockResolvedValue(CACHE);
  mocks.clearCache.mockResolvedValue({ path: 'C:/cache', bytes: 0, fileCount: 0 });
  mocks.exportSettings.mockResolvedValue({ saved: true, path: 'C:/out/settings.json' });
  mocks.importSettings.mockResolvedValue({ imported: 5, skipped: 1 });
  mocks.resetAll.mockResolvedValue({});
  mocks.openDataDir.mockResolvedValue({ ok: true });
  useUpdateStore.setState({ status: null });
  useSettingsStore.setState({ language: 'zh-CN', proxy: { mode: 'system' } });
});

describe('DataSection', () => {
  it('正向：渲染数据区与备份子块', async () => {
    renderSection();

    expect(screen.getByText(t('settings.dataSection'))).toBeDefined();
    expect(screen.getByTestId('backup-block')).toBeDefined();
    await screen.findByText(t('settings.updateCacheUsage', { size: '1.0 KB', count: '3' }));
  });

  it('打开数据目录：成功 → 成功 toast', async () => {
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.openDataDir') }));

    await waitFor(() => expect(mocks.openDataDir).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(t('settings.dataDirOpened'));
  });

  it('打开数据目录：返回 ok=false → 失败 toast', async () => {
    mocks.openDataDir.mockResolvedValue({ ok: false });
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.openDataDir') }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(t('settings.exportFailed')));
  });

  it('打开数据目录：异常 → 静默（不误报失败）', async () => {
    mocks.openDataDir.mockRejectedValue(new Error('boom'));
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.openDataDir') }));

    await waitFor(() => expect(mocks.openDataDir).toHaveBeenCalledOnce());
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('导出设置：saved → 成功 toast 带路径', async () => {
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.exportSettings') }));

    await waitFor(() => expect(mocks.exportSettings).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      t('settings.exportSuccess', { path: 'C:/out/settings.json' }),
    );
  });

  it('导出设置：代理 URL 含凭据 → 先确认；拒绝则不导出', async () => {
    useSettingsStore.setState({
      proxy: { mode: 'fixed', url: 'http://user:pass@proxy.example:8080' },
    });
    mocks.confirm.mockResolvedValue(false);
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.exportSettings') }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.exportSettings).not.toHaveBeenCalled();
  });

  it('导出设置：代理 URL 含凭据且确认 → 继续导出', async () => {
    useSettingsStore.setState({
      proxy: { mode: 'fixed', url: 'http://user:pass@proxy.example:8080' },
    });
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.exportSettings') }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.exportSettings).toHaveBeenCalledOnce());
  });

  it('导出设置：未保存（用户取消）→ 不 toast', async () => {
    mocks.exportSettings.mockResolvedValue({ saved: false });
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.exportSettings') }));

    await waitFor(() => expect(mocks.exportSettings).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('导出设置：失败 → 错误 toast', async () => {
    mocks.exportSettings.mockRejectedValue(new Error('nope'));
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.exportSettings') }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(t('settings.exportSettingsFailed')),
    );
  });

  it('导入设置：confirm 放行 → 展示导入/跳过计数', async () => {
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.importSettings') }));

    await waitFor(() => expect(mocks.importSettings).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      t('settings.importSettingsDone', { imported: 5, skipped: 1 }),
    );
  });

  it('导入设置：confirm 拒绝 → 不调用 IPC', async () => {
    mocks.confirm.mockResolvedValue(false);
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.importSettings') }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.importSettings).not.toHaveBeenCalled();
  });

  it('恢复默认：confirm 放行 → 重置并回落空快照', async () => {
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.resetAllSettings') }));

    await waitFor(() => expect(mocks.resetAll).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(t('settings.resetAllSettingsDone'));
  });

  it('恢复默认：失败 → 错误 toast', async () => {
    mocks.resetAll.mockRejectedValue(new Error('boom'));
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: t('settings.resetAllSettings') }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(t('settings.resetAllSettingsFailed')),
    );
  });

  it('更新缓存：下载中禁用清理按钮', async () => {
    useUpdateStore.setState({ status: { phase: 'downloading', version: '1.0.0', progress: 5 } });
    renderSection();

    await screen.findByText(t('settings.updateCacheUsage', { size: '1.0 KB', count: '3' }));
    expect(screen.getByRole('button', { name: t('settings.clearUpdateCache') })).toBeDisabled();
  });

  it('更新缓存：清理成功 → 刷新占用并 toast', async () => {
    renderSection();
    await screen.findByText(t('settings.updateCacheUsage', { size: '1.0 KB', count: '3' }));

    await userEvent.click(screen.getByRole('button', { name: t('settings.clearUpdateCache') }));

    await waitFor(() => expect(mocks.clearCache).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(t('settings.clearUpdateCacheDone'));
  });

  it('更新缓存：路径为空 → 不渲染清理入口', async () => {
    mocks.getCache.mockResolvedValue({ path: null, bytes: 0, fileCount: 0 });
    renderSection();

    await waitFor(() => expect(mocks.getCache).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: t('settings.clearUpdateCache') })).toBeNull();
  });
});
