import { describe, expect, it } from 'vitest';

import {
  buildSourcemapCommands,
  resolveSentryRelease,
  resolveSentryUploadConfig,
} from './sentry-upload';

const completeEnv = {
  ['SENTRY_AUTH_TOKEN']: 'token',
  ['SENTRY_ORG']: 'org',
  ['SENTRY_PROJECT']: 'project',
};

describe('resolveSentryRelease', () => {
  it('默认 {可执行名}@{版本}', () => {
    expect(resolveSentryRelease({}, 'app', '1.2.3')).toBe('app@1.2.3');
  });

  it('SENTRY_RELEASE 覆盖（运行时与上传共用）', () => {
    expect(resolveSentryRelease({ ['SENTRY_RELEASE']: 'custom@2.0.0' }, 'app', '1.2.3')).toBe(
      'custom@2.0.0',
    );
  });
});

describe('resolveSentryUploadConfig', () => {
  it('凭据齐全：不跳过，release 与 outDir 就位', () => {
    const config = resolveSentryUploadConfig(completeEnv, 'app', '1.2.3', 'out');
    expect(config).toMatchObject({
      authToken: 'token',
      org: 'org',
      project: 'project',
      release: 'app@1.2.3',
      outDir: 'out',
      skipReason: null,
    });
  });

  it('缺任一凭据：skipReason 列出缺失项', () => {
    const config = resolveSentryUploadConfig(
      { ['SENTRY_AUTH_TOKEN']: 'token' },
      'app',
      '1.2.3',
      'out',
    );
    expect(config.skipReason).toBe('缺少 SENTRY_ORG / SENTRY_PROJECT');
  });

  it('显式禁用优先于凭据检查', () => {
    const config = resolveSentryUploadConfig(
      { ...completeEnv, ['SENTRY_UPLOAD_DISABLED']: '1' },
      'app',
      '1.2.3',
      'out',
    );
    expect(config.skipReason).toBe('SENTRY_UPLOAD_DISABLED=1');
  });
});

describe('buildSourcemapCommands', () => {
  it('顺序：releases new → inject → upload → finalize，且带 org/project', () => {
    const config = resolveSentryUploadConfig(completeEnv, 'app', '1.2.3', 'out');
    const commands = buildSourcemapCommands(config);
    expect(commands.map((args) => args.slice(0, 2))).toEqual([
      ['releases', 'new'],
      ['sourcemaps', 'inject'],
      ['sourcemaps', 'upload'],
      ['releases', 'finalize'],
    ]);
    for (const args of commands) {
      expect(args).toContain('--org');
      expect(args).toContain('--project');
    }
    expect(commands[2]).toContain('--release');
    expect(commands[2]).toContain('app@1.2.3');
  });
});
