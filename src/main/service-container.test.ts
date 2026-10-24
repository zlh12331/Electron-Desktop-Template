import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  marker: null as null | { timestamp: number; message: string; stack?: string },
  clearCrashMarker: vi.fn(),
  reportError: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('electron-updater', () => ({
  default: { autoUpdater: {}, ['CancellationToken']: class {} },
}));
vi.mock('./infra/storage/db', () => ({ closeDb: vi.fn(), resetDb: vi.fn() }));
vi.mock('./infra/update/update-service', () => ({ ['UpdateService']: class {} }));
vi.mock('./utils/logger', () => ({
  logger: mocks.logger,
  readCrashMarker: () => mocks.marker,
  clearCrashMarker: mocks.clearCrashMarker,
}));
vi.mock('./utils/error-report', () => ({ reportError: mocks.reportError }));

import { recoverFromCrash } from './service-container';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.marker = null;
});

describe('recoverFromCrash', () => {
  it('存在崩溃标记：上报带时间/来源标签的错误并清理标记', async () => {
    mocks.marker = { timestamp: 1_700_000_000_000, message: 'boom', stack: 'at x' };
    await recoverFromCrash();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom', crashedAt: expect.any(String) }),
      '检测到上次进程异常退出（崩溃标记）',
    );
    const [error, context] = mocks.reportError.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(error.message).toBe('上次进程异常退出：boom');
    expect(error.stack).toBe('at x');
    expect(context.tags).toMatchObject({
      scope: 'crash-recovery',
      'crash.previous': 'true',
      'crash.timestamp': expect.any(String),
    });
    expect(mocks.clearCrashMarker).toHaveBeenCalledTimes(1);
  });

  it('无崩溃标记：不产生错误上报，仍清理标记', async () => {
    await recoverFromCrash();
    expect(mocks.reportError).not.toHaveBeenCalled();
    expect(mocks.clearCrashMarker).toHaveBeenCalledTimes(1);
  });
});
