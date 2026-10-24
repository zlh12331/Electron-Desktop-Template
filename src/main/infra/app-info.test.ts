import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

vi.mock('electron', () => ({ app: mocks.app }));

import { readBuildInfo } from './app-info';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'app-info-'));
  mkdirSync(join(tempDir, 'resources'), { recursive: true });
  mocks.app.getAppPath.mockReturnValue(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('readBuildInfo', () => {
  it('读取 dev resources/build-info.json', () => {
    writeFileSync(
      join(tempDir, 'resources', 'build-info.json'),
      JSON.stringify({ version: '1.2.3', channel: 'beta', commitSha: 'abc' }),
      'utf8',
    );
    expect(readBuildInfo()).toEqual({ version: '1.2.3', channel: 'beta', commitSha: 'abc' });
  });

  it('文件缺失/损坏：回退 channel=dev', () => {
    expect(readBuildInfo()).toEqual({ channel: 'dev' });
    writeFileSync(join(tempDir, 'resources', 'build-info.json'), '{bad', 'utf8');
    expect(readBuildInfo()).toEqual({ channel: 'dev' });
  });
});
