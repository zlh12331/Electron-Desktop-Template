import type { ObservabilityEnvEntry } from '@code-agent/shared/observability';
import { describe, expect, it } from 'vitest';

import {
  extractDeclaredEnvKeys,
  extractObservabilityEnvKeys,
  findMissingKeys,
  findUnknownKeys,
  validateRegistry,
} from './observability-config-check';

const entries: ObservabilityEnvEntry[] = [
  {
    key: 'SENTRY_DSN',
    scopes: ['runtime'],
    defaultValue: '',
    description: 'dsn',
    sensitive: false,
    restartRequired: true,
    consumers: ['sentry'],
  },
  {
    key: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    scopes: ['runtime'],
    defaultValue: '',
    description: 'endpoint',
    sensitive: false,
    restartRequired: true,
    consumers: ['otel'],
  },
];

const firstEntry = entries[0];
if (firstEntry === undefined) {
  throw new Error('fixture entries empty');
}

describe('extractObservabilityEnvKeys', () => {
  it('提取 process.env / env 下标访问，去重并只保留 SENTRY/OTEL 前缀', () => {
    const text = [
      "process.env['SENTRY_DSN']",
      "env['OTEL_EXPORTER_OTLP_ENDPOINT']",
      "process.env['APP_USER_DATA']",
      "process.env['SENTRY_DSN']",
    ].join('\n');
    expect(extractObservabilityEnvKeys(text)).toEqual(
      new Set(['SENTRY_DSN', 'OTEL_EXPORTER_OTLP_ENDPOINT']),
    );
  });
});

describe('extractDeclaredEnvKeys', () => {
  it('支持注释行与普通 key=value，忽略其他前缀', () => {
    const text = ['# SENTRY_DSN="x"', 'OTEL_LOG_LEVEL="info"', 'APP_DEBUG_PORT="9222"'].join('\n');
    expect(extractDeclaredEnvKeys(text)).toEqual(new Set(['SENTRY_DSN', 'OTEL_LOG_LEVEL']));
  });
});

describe('validateRegistry', () => {
  it('合法注册表通过', () => {
    expect(validateRegistry(entries)).toEqual([]);
  });

  it('重复键/空描述/无消费方/非法键名均被报告', () => {
    const bad: ObservabilityEnvEntry[] = [
      { ...firstEntry, key: 'sentry_dsn' },
      { ...firstEntry, description: ' ' },
      { ...firstEntry, consumers: [] },
      { ...firstEntry, key: 'SENTRY_DSN' },
    ];
    const problems = validateRegistry(bad);
    expect(problems.some((problem) => problem.includes('键名不合规'))).toBe(true);
    expect(problems.some((problem) => problem.includes('缺少描述'))).toBe(true);
    expect(problems.some((problem) => problem.includes('缺少消费方'))).toBe(true);
    expect(problems.some((problem) => problem.includes('重复键'))).toBe(true);
  });
});

describe('findMissingKeys / findUnknownKeys', () => {
  it('缺失键与未注册键都能定位', () => {
    expect(findMissingKeys(entries, 'SENTRY_DSN only', '.env')).toEqual([
      '.env 缺少 OTEL_EXPORTER_OTLP_ENDPOINT',
    ]);
    const refs = new Map<string, ReadonlySet<string>>([
      ['src/a.ts', new Set(['SENTRY_DSN', 'SENTRY_UNKNOWN'])],
    ]);
    expect(findUnknownKeys(entries, refs)).toEqual(['src/a.ts 引用了未注册变量 SENTRY_UNKNOWN']);
  });
});
