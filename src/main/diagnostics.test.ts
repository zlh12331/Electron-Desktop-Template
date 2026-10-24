import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDiagnosticsPackage } from './diagnostics';
import { closeDb, initDb, resetDb } from './infra/storage/db';
import { writeSetting } from './infra/storage/settings-pref';
import { redactSensitive } from './infra/telemetry/redact';

const mocks = vi.hoisted(() => ({
  mockGetPath: vi.fn(() => '/tmp/diagnostics-default'),
}));

vi.mock('electron', () => ({
  app: {
    getName: () => 'code-agent-desktop',
    getVersion: () => '1.0.0',
    getPath: mocks.mockGetPath,
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

vi.mock('./utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./infra/telemetry/sentry', () => ({
  getSentryStatus: () => ({
    enabled: false,
    initialized: false,
    reason: 'no-dsn',
    release: null,
    environment: null,
  }),
}));

vi.mock('./infra/telemetry/otel', () => ({
  getTelemetryRuntimeStatus: () => ({
    level: 'full',
    enabled: false,
    tracing: false,
    metrics: false,
    logs: false,
    endpointConfigured: false,
  }),
}));

let tempUserData: string;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setupTempEnvironment(): void {
  tempUserData = makeTempDir('diag-');
  mocks.mockGetPath.mockReturnValue(tempUserData);
  initDb();
  writeSetting('theme', 'dark');
  writeSetting('model', 'deepseek-flash');
  writeSetting('credentials', { apiKey: 'sk-super-secret', baseUrl: 'https://api.example.com' });
  writeSetting('tokens', ['t-1', 't-2']);
}

beforeEach(() => {
  setupTempEnvironment();
});

afterEach(async () => {
  await closeDb();
  resetDb();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('redactSensitive', () => {
  it('命中敏感键：值替换为 [REDACTED]', () => {
    expect(redactSensitive('sk-123456', 'apiKey')).toBe('[REDACTED]');
    expect(redactSensitive('abcd', 'provider.api_key')).toBe('[REDACTED]');
    expect(redactSensitive('abc', 'ACCESS_TOKEN')).toBe('[REDACTED]');
    expect(redactSensitive('secret', 'authPassword')).toBe('[REDACTED]');
  });

  it('普通键：原样透传', () => {
    expect(redactSensitive('deepseek', 'provider')).toBe('deepseek');
    expect(redactSensitive(42, 'theme.fontSize')).toBe(42);
    expect(redactSensitive(undefined, 'optional')).toBeUndefined();
    expect(redactSensitive(null, 'nullValue')).toBeNull();
  });

  it('嵌套对象：逐层脱敏且不修改原对象（纯函数）', () => {
    const input = {
      model: 'deepseek-flash',
      credentials: { apiKey: 'sk-secret', baseUrl: 'https://api.example.com' },
    };
    const result = redactSensitive(input) as Record<string, unknown>;
    expect(result['model']).toBe('deepseek-flash');
    expect((result['credentials'] as Record<string, unknown>)['apiKey']).toBe('[REDACTED]');
    expect((result['credentials'] as Record<string, unknown>)['baseUrl']).toBe(
      'https://api.example.com',
    );
    expect((input.credentials as { apiKey: string }).apiKey).toBe('sk-secret');
  });

  it('数组：逐项脱敏', () => {
    const result = redactSensitive([{ token: 't1' }, { name: 'keep' }]) as unknown[];
    expect(result[0]).toEqual({ token: '[REDACTED]' });
    expect(result[1]).toEqual({ name: 'keep' });
  });
});

describe('exportDiagnosticsPackage', () => {
  it('打包：manifest/settings（脱敏）/logs 三件套齐全', async () => {
    // 日志目录与 userData 分离：证明导出按 logsPath（app.getPath('logs')）收集，
    // 而不是沿用 userData/logs 的 macOS 错误假设
    const logsDir = makeTempDir('diag-logs-');
    writeFileSync(join(logsDir, 'main.log'), '2026-09-04 info ready\n', 'utf8');
    writeFileSync(join(logsDir, 'main.old.log'), 'rotated\n', 'utf8');
    const decoyDir = join(tempUserData, 'logs');
    mkdirSync(decoyDir, { recursive: true });
    writeFileSync(join(decoyDir, 'decoy.log'), 'should not be packaged\n', 'utf8');

    const target = join(makeTempDir('diag-out-'), 'pack.zip');

    await exportDiagnosticsPackage({
      filePath: target,
      userDataPath: tempUserData,
      logsPath: logsDir,
    });

    const zip = new AdmZip(target);
    const names = zip
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();
    expect(names).toContain('manifest.json');
    expect(names).toContain('settings.json');
    expect(names).toContain('logs/main.log');
    expect(names).toContain('logs/main.old.log');
    expect(names).not.toContain('logs/decoy.log');

    const manifest = JSON.parse(zip.readAsText('manifest.json')) as Record<string, unknown>;
    expect(manifest['appVersion']).toBe('1.0.0');
    expect(manifest['exportedAt']).toBeTypeOf('string');
    expect((manifest['versions'] as Record<string, unknown>)['node']).toBeTypeOf('string');

    const settings = JSON.parse(zip.readAsText('settings.json')) as Record<string, unknown>;
    expect(settings['theme']).toBe('dark');
    expect(settings['model']).toBe('deepseek-flash');
    expect((settings['credentials'] as { apiKey: string }).apiKey).toBe('[REDACTED]');
    expect((settings['credentials'] as { baseUrl: string }).baseUrl).toBe(
      'https://api.example.com',
    );
    expect(settings['tokens']).toEqual(['[REDACTED]', '[REDACTED]']);
  });

  it('打包：日志目录缺失时降级为空日志段，不抛错', async () => {
    const target = join(makeTempDir('diag-out-'), 'pack.zip');

    await expect(
      exportDiagnosticsPackage({
        filePath: target,
        userDataPath: tempUserData,
        logsPath: join(tempUserData, 'missing-logs'),
      }),
    ).resolves.toBeUndefined();

    const zip = new AdmZip(target);
    const names = zip.getEntries().map((entry) => entry.entryName);
    expect(names).toContain('manifest.json');
    expect(names).toContain('settings.json');
  });
});
