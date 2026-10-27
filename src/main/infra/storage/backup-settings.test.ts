import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readSetting: vi.fn(),
}));

vi.mock('./settings-pref', () => ({
  readSetting: mocks.readSetting,
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { readBackupPolicy } = await import('./backup-settings');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readBackupPolicy', () => {
  it('缺失 → 默认自动备份开 + 保留 3 份', () => {
    mocks.readSetting.mockReturnValue(undefined);
    expect(readBackupPolicy()).toEqual({ autoBackup: true, keep: 3 });
  });

  it('合法值原样读取，非法 keep 回落 3', () => {
    mocks.readSetting.mockReturnValue({ autoBackup: false, keep: 5 });
    expect(readBackupPolicy()).toEqual({ autoBackup: false, keep: 5 });

    mocks.readSetting.mockReturnValue({ autoBackup: true, keep: 4 });
    expect(readBackupPolicy()).toEqual({ autoBackup: true, keep: 3 });
  });

  it('损坏/读取异常 → 默认策略', () => {
    mocks.readSetting.mockReturnValue(null);
    expect(readBackupPolicy()).toEqual({ autoBackup: true, keep: 3 });

    mocks.readSetting.mockReturnValue('broken');
    expect(readBackupPolicy()).toEqual({ autoBackup: true, keep: 3 });

    mocks.readSetting.mockImplementation(() => {
      throw new Error('db unavailable');
    });
    expect(readBackupPolicy()).toEqual({ autoBackup: true, keep: 3 });
  });
});
