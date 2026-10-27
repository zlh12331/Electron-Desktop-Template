import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportDiagnostics: vi.fn(),
  openDataDir: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/settings-ops', () => ({
  exportDiagnostics: mocks.exportDiagnostics,
}));
vi.mock('@/lib/app-actions', () => ({
  openDataDir: mocks.openDataDir,
}));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { i18n } from '@/i18n';
import {
  copyToClipboard,
  DiagnosticsCard,
  exportDiagnostics,
  openDataDirAction,
} from './diagnostics-card';

const t = i18n.t.bind(i18n);

const INFO = {
  version: '1.2.3',
  electron: '45.0.0',
  node: '26.12.1',
  chrome: '140.0.0',
  platform: 'win32',
  arch: 'x64',
  userDataPath: 'C:/data',
  channel: 'stable',
  buildTime: '2026-10-25T00:00:00.000Z',
  commitSha: 'abc1234',
} as const;

function renderCard(
  overrides: {
    info?: typeof INFO | null;
    copying?: boolean;
    exporting?: boolean;
    onCopy?: (text: string) => void;
    onExport?: () => void;
  } = {},
): { onCopy: ReturnType<typeof vi.fn>; onExport: ReturnType<typeof vi.fn> } {
  const onCopy = vi.fn(overrides.onCopy);
  const onExport = vi.fn(overrides.onExport);
  render(
    <DiagnosticsCard
      info={overrides.info === undefined ? INFO : overrides.info}
      locale="zh-CN"
      copying={overrides.copying ?? false}
      exporting={overrides.exporting ?? false}
      onCopy={onCopy}
      onExport={onExport}
    />,
  );
  return { onCopy, onExport };
}

describe('diagnostics-card helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copyToClipboard：成功/失败均有反馈', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await copyToClipboard('hello', t);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();

    writeText.mockRejectedValueOnce(new Error('denied'));
    await copyToClipboard('hello', t);
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });

  it('exportDiagnostics：成功、取消、null、异常分支', async () => {
    mocks.exportDiagnostics.mockResolvedValue({ saved: true, path: 'C:/diag.zip' });
    await exportDiagnostics(t);
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();

    mocks.exportDiagnostics.mockResolvedValue({ saved: false });
    await exportDiagnostics(t);
    expect(mocks.toastError).toHaveBeenCalledOnce();

    mocks.exportDiagnostics.mockResolvedValue(null);
    await exportDiagnostics(t);
    expect(mocks.toastError).toHaveBeenCalledOnce();

    mocks.exportDiagnostics.mockRejectedValue(new Error('boom'));
    await exportDiagnostics(t);
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
  });

  it('openDataDirAction：透传 openDataDir', () => {
    openDataDirAction();
    expect(mocks.openDataDir).toHaveBeenCalledOnce();
  });
});

describe('DiagnosticsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('有 info：复制诊断信息、打开目录、导出按钮可用', async () => {
    const user = userEvent.setup();
    const { onCopy, onExport } = renderCard();

    await user.click(screen.getByRole('button', { name: t('settings.aboutCopyDiagnostics') }));
    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('1.2.3'));
    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('abc1234'));

    await user.click(screen.getByRole('button', { name: t('settings.aboutOpenDataDir') }));
    expect(mocks.openDataDir).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: t('settings.aboutExportDiagnostics') }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('info 为 null 或 copying/exporting：禁用对应按钮', () => {
    renderCard({ info: null, copying: true, exporting: true });

    expect(screen.getByRole('button', { name: t('settings.aboutCopyDiagnostics') })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: t('settings.aboutExportDiagnostics') }),
    ).toBeDisabled();
  });
});
