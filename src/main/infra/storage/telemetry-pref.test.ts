import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paths = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn() } }));

import { readTelemetryLevelSync, writeTelemetryLevel } from './telemetry-pref';

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'telemetry-pref-'));
});
afterEach(() => {
  rmSync(paths.userData, { recursive: true, force: true });
});

describe('遥测同意偏好', () => {
  it('首次安装默认 off，不隐式开启网络采集', () => {
    expect(readTelemetryLevelSync()).toBe('off');
  });

  it.each(['not-json', 'null', '{}', '{"level":"invalid"}', '{"level":{}}'])(
    '损坏文件 %s 默认 off',
    (content) => {
      writeFileSync(join(paths.userData, 'telemetry-pref.json'), content);
      expect(readTelemetryLevelSync()).toBe('off');
    },
  );

  it.each(['off', 'error-only', 'full'] as const)(
    '显式选择 %s 原子保存并可跨读取恢复',
    async (level) => {
      await writeTelemetryLevel(level);
      expect(readTelemetryLevelSync()).toBe(level);
      expect(existsSync(join(paths.userData, 'telemetry-pref.json.tmp'))).toBe(false);
    },
  );
});
