import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let directory: string;
const script = join(import.meta.dirname, 'observability-doctor.ts');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'otel-doctor-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function runDoctor(
  extra: string[] = [],
  overrides: Record<string, string> = {},
): { config: { level: string; otel: { serviceName: string } } } {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(SENTRY_|OTEL_|APP_ENV_FILE|APP_USER_DATA)/.test(key),
    ),
  );
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      script,
      '--offline',
      '--json',
      `--env-file=${join(directory, '.env')}`,
      `--user-data=${directory}`,
      ...extra,
    ],
    { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000 },
  );
  return JSON.parse(output);
}

describe('observability doctor CLI', () => {
  it('读取指定环境和同意偏好，JSON 输出只有一个文档', () => {
    writeFileSync(join(directory, '.env'), 'OTEL_SERVICE_NAME=doctor-from-file\n');
    writeFileSync(join(directory, 'telemetry-pref.json'), '{"level":"error-only"}');
    const result = runDoctor();
    expect(result.config.level).toBe('error-only');
    expect(result.config.otel.serviceName).toBe('doctor-from-file');
  });

  it('进程环境优先，缺同意记录默认 off，release 显式模拟 full', () => {
    writeFileSync(join(directory, '.env'), 'OTEL_SERVICE_NAME=doctor-from-file\n');
    expect(runDoctor([], { ['OTEL_SERVICE_NAME']: 'doctor-env' }).config).toMatchObject({
      level: 'off',
      otel: { serviceName: 'doctor-env' },
    });
    expect(runDoctor(['--release']).config.level).toBe('full');
  });
});
