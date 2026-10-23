// biome-ignore-all lint/style/useNamingConvention: 测试直接构造 SENTRY_*/OTEL_* 环境变量键

import {
  resolveObservabilityConfig,
  resolveSentryUploadConfig,
} from '@code-agent/shared/observability';
import { describe, expect, it } from 'vitest';

import {
  buildDoctorChecks,
  buildProbeTargets,
  hasFailures,
  summarizeConfig,
} from './observability-doctor';

function context(env: Record<string, string> = {}): {
  reads: ReturnType<typeof resolveObservabilityConfig>;
  upload: ReturnType<typeof resolveSentryUploadConfig>;
} {
  return {
    reads: resolveObservabilityConfig(env, {
      isPackaged: true,
      level: 'full',
      version: '1.0.0',
      executableName: 'app',
    }),
    upload: resolveSentryUploadConfig(env, 'app', '1.0.0', 'out'),
  };
}

describe('buildDoctorChecks', () => {
  it('未配置 Sentry/上传凭据：skip 而不 fail', () => {
    const { reads, upload } = context();
    const checks = buildDoctorChecks({}, reads, upload, { strictUpload: false });
    expect(hasFailures(checks)).toBe(false);
    expect(checks.find((check) => check.id === 'upload.credentials')?.status).toBe('skip');
  });

  it('半配置上传凭据：release 模式 fail，本地模式 warn', () => {
    const env = { SENTRY_AUTH_TOKEN: 'token' };
    const { reads, upload } = context(env);
    expect(
      buildDoctorChecks(env, reads, upload, { strictUpload: true }).find(
        (check) => check.id === 'upload.credentials',
      )?.status,
    ).toBe('fail');
    expect(
      buildDoctorChecks(env, reads, upload, { strictUpload: false }).find(
        (check) => check.id === 'upload.credentials',
      )?.status,
    ).toBe('warn');
  });

  it('token 但无 DSN：warn 提示运行时不发事件', () => {
    const env = {
      SENTRY_AUTH_TOKEN: 'token',
      SENTRY_ORG: 'org',
      SENTRY_PROJECT: 'project',
    };
    const { reads, upload } = context(env);
    const checks = buildDoctorChecks(env, reads, upload, { strictUpload: true });
    expect(checks.find((check) => check.id === 'sentry.token-without-dsn')?.status).toBe('warn');
  });

  it('非法 OTLP 端点：fail', () => {
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url' };
    const { reads, upload } = context(env);
    const checks = buildDoctorChecks(env, reads, upload, { strictUpload: false });
    expect(checks.find((check) => check.id === 'otel.traces.endpoint')?.status).toBe('fail');
    expect(hasFailures(checks)).toBe(true);
  });

  it('非法 override 产生 warn', () => {
    const env = {
      OTEL_TRACES_SAMPLER_ARG: '9',
      OTEL_LOG_LEVEL: 'verbose',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    };
    const { reads, upload } = context(env);
    const checks = buildDoctorChecks(env, reads, upload, { strictUpload: false });
    expect(checks.some((check) => check.id === 'env.OTEL_TRACES_SAMPLER_ARG')).toBe(true);
    expect(checks.some((check) => check.id === 'env.OTEL_LOG_LEVEL')).toBe(true);
  });
});

describe('buildProbeTargets', () => {
  it('只包含已配置端点', () => {
    const { reads } = context({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' });
    expect(buildProbeTargets(reads.otel)).toEqual([
      { signal: 'traces', url: 'http://127.0.0.1:4318/v1/traces' },
      { signal: 'metrics', url: 'http://127.0.0.1:4318/v1/metrics' },
      { signal: 'logs', url: 'http://127.0.0.1:4318/v1/logs' },
    ]);
  });
});

describe('summarizeConfig', () => {
  it('DSN 脱敏，OTLP headers 只暴露 key', () => {
    const env = {
      SENTRY_DSN: 'https://key@example.com/42',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-token=secret',
    };
    const { reads, upload } = context(env);
    const summary = summarizeConfig(reads, upload) as {
      sentry: { dsn: string };
      otel: { headerKeys: string[] };
    };
    expect(summary.sentry.dsn).toBe('https://***@example.com/42');
    expect(summary.otel.headerKeys).toEqual(['x-token']);
    expect(JSON.stringify(summary)).not.toContain('secret');
  });
});
