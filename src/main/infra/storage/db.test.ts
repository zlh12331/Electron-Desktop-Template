import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupDirPath, listBackupNames } from './backup-store';
import { closeDb, createManualBackup, getDbPath, initDb, resetDb } from './db';
import { readSetting, writeSetting } from './settings-pref';

const mocks = vi.hoisted(() => ({
  mockGetPath: vi.fn(() => '/tmp/db-default'),
}));

vi.mock('electron', () => ({
  app: {
    getPath: mocks.mockGetPath,
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/error-report', () => ({
  reportError: vi.fn(),
}));

vi.mock('../telemetry/otel-metrics', () => ({
  recordDbBackup: vi.fn(),
  recordDbRecovery: vi.fn(),
}));

let tempDir: string;

function corruptMainDb(): void {
  writeFileSync(getDbPath(), 'not a sqlite database');
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${getDbPath()}${suffix}`, { force: true });
  }
}

function removeBackups(): void {
  rmSync(backupDirPath(getDbPath()), { recursive: true, force: true });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('db 启动自愈与备份', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'db-recovery-'));
    mocks.mockGetPath.mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await closeDb();
    resetDb();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('健康库重开：保留设置并再次通过完整性校验', async () => {
    initDb();
    writeSetting('theme', 'light');
    await closeDb();
    initDb();
    expect(readSetting('theme')).toBe('light');
  });

  it('损坏库 + 健康备份：从最新备份恢复', async () => {
    initDb();
    writeSetting('theme', 'light');
    await createManualBackup();
    await closeDb();

    corruptMainDb();
    initDb();
    expect(readSetting('theme')).toBe('light');
  });

  it('最新备份损坏：跳过并回退到更早的健康备份', async () => {
    initDb();
    removeBackups();
    writeSetting('theme', 'light');
    await createManualBackup();
    await wait(10);
    writeSetting('theme', 'dark');
    await createManualBackup();
    await closeDb();

    const newest = listBackupNames(getDbPath()).at(-1);
    if (newest === undefined) {
      throw new Error('未生成备份，无法构造损坏最新备份场景');
    }
    writeFileSync(join(backupDirPath(getDbPath()), newest), 'broken backup');

    corruptMainDb();
    initDb();
    expect(readSetting('theme')).toBe('light');
  });

  it('损坏库且无备份：归档损坏文件并重建空库', async () => {
    initDb();
    writeSetting('theme', 'light');
    await closeDb();
    removeBackups();

    corruptMainDb();
    initDb();

    expect(readSetting('theme')).toBeUndefined();
    expect(readdirSync(tempDir).some((name) => name.includes('.corrupt-'))).toBe(true);
  });

  it('手动备份排空启动备份链后才返回', async () => {
    initDb();
    const { name } = await createManualBackup();
    expect(name.endsWith('.db')).toBe(true);
    expect(listBackupNames(getDbPath())).toContain(name);
  });
});
