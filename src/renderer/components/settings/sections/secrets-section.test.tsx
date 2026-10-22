import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { SecretsSection } from './secrets-section';

const t = i18n.t.bind(i18n);

const mocks = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  list: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  getMasked: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/stores/transient/confirm-dialog-store', () => ({
  confirm: mocks.confirm,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

function renderWithQuery(ui: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAvailable.mockResolvedValue({ data: { available: true, platform: 'win32' } });
  mocks.list.mockResolvedValue({ data: { keys: [] } });
  mocks.set.mockResolvedValue({ data: { ok: true } });
  mocks.delete.mockResolvedValue({ data: { ok: true } });
  mocks.getMasked.mockResolvedValue({ data: { masked: 'sk-****abcd' } });
  mocks.confirm.mockResolvedValue(true);
  Object.defineProperty(window, 'api', {
    value: {
      secrets: {
        isAvailable: mocks.isAvailable,
        list: mocks.list,
        set: mocks.set,
        delete: mocks.delete,
        getMasked: mocks.getMasked,
      },
    },
    writable: true,
    configurable: true,
  });
});

describe('SecretsSection', () => {
  it('空态：显示新增表单与空提示', async () => {
    renderWithQuery(<SecretsSection />);

    expect(await screen.findByText(t('settings.secretsEmpty'))).toBeDefined();
    expect(await screen.findByLabelText(t('settings.secretsKeyLabel'))).toBeDefined();
    expect(screen.getByLabelText(t('settings.secretsValueLabel'))).toBeDefined();
  });

  it('加密不可用：隐藏写入口并显示警示', async () => {
    mocks.isAvailable.mockResolvedValue({ data: { available: false, platform: 'linux' } });
    renderWithQuery(<SecretsSection />);

    expect(await screen.findByText(t('settings.secretsUnavailable'))).toBeDefined();
    expect(screen.queryByLabelText(t('settings.secretsKeyLabel'))).toBeNull();
  });

  it('已存凭据：只展示掩码，不展示明文', async () => {
    mocks.list.mockResolvedValue({ data: { keys: ['api-key'] } });
    renderWithQuery(<SecretsSection />);

    expect(await screen.findByText('api-key')).toBeDefined();
    expect(await screen.findByText('sk-****abcd')).toBeDefined();
    expect(screen.queryByDisplayValue('sk-****abcd')).toBeNull();
  });

  it('保存：键名与值经 IPC 提交，成功后清空表单', async () => {
    renderWithQuery(<SecretsSection />);
    await screen.findByText(t('settings.secretsEmpty'));

    await userEvent.type(await screen.findByLabelText(t('settings.secretsKeyLabel')), 'my-token');
    await userEvent.type(screen.getByLabelText(t('settings.secretsValueLabel')), 'secret-value');
    await userEvent.click(screen.getByRole('button', { name: t('settings.secretsSave') }));

    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    expect(mocks.set.mock.calls[0]?.[0]).toEqual({ key: 'my-token', value: 'secret-value' });
    await waitFor(() => {
      expect((screen.getByLabelText(t('settings.secretsKeyLabel')) as HTMLInputElement).value).toBe(
        '',
      );
    });
  });

  it('保存按钮：键名或值为空时禁用', async () => {
    renderWithQuery(<SecretsSection />);

    const saveButton = (await screen.findByRole('button', {
      name: t('settings.secretsSave'),
    })) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(t('settings.secretsKeyLabel')), 'k');
    expect(saveButton.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(t('settings.secretsValueLabel')), 'v');
    expect(saveButton.disabled).toBe(false);
  });

  it('删除：confirm 放行后调用 delete', async () => {
    mocks.list.mockResolvedValue({ data: { keys: ['api-key'] } });
    renderWithQuery(<SecretsSection />);

    await userEvent.click(
      await screen.findByRole('button', { name: t('settings.secretsDelete', { key: 'api-key' }) }),
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith({ key: 'api-key' }));
  });

  it('删除：confirm 拒绝时不调用 delete', async () => {
    mocks.confirm.mockResolvedValue(false);
    mocks.list.mockResolvedValue({ data: { keys: ['api-key'] } });
    renderWithQuery(<SecretsSection />);

    await userEvent.click(
      await screen.findByRole('button', { name: t('settings.secretsDelete', { key: 'api-key' }) }),
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
