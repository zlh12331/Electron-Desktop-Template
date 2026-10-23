// observability-doctor.ts：打印脱敏后的生效配置，校验格式并探测 OTLP 连通性
// 用法：
//   pnpm observability:doctor
//   pnpm observability:doctor --offline
//   pnpm observability:doctor --release --offline   # CI 发布前断言（半配置凭据 fail）
//   pnpm observability:doctor --json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  probeOtlpTargets,
  resolveObservabilityConfig,
  resolveSentryUploadConfig,
  TELEMETRY_LEVELS,
  type TelemetryLevel,
} from '@code-agent/shared/observability';

import {
  buildDoctorChecks,
  buildProbeTargets,
  type DoctorCheck,
  hasFailures,
  summarizeConfig,
} from './lib/observability-doctor';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const json = args.includes('--json');
const release = args.includes('--release');
const packaged = args.includes('--packaged');
const levelArg = args.find((arg) => arg.startsWith('--level='))?.slice('--level='.length) ?? 'full';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

if (!(TELEMETRY_LEVELS as readonly string[]).includes(levelArg)) {
  console.error(
    `[observability-doctor] 非法 --level=${levelArg}（可选 ${TELEMETRY_LEVELS.join('/')}）`,
  );
  process.exit(1);
}
const level = levelArg as TelemetryLevel;
const appConfig = readJson<{ executableName: string }>(join(root, 'app.config.json'));
const pkg = readJson<{ version: string }>(join(root, 'package.json'));
const outDir = join(root, 'out');

const resolved = resolveObservabilityConfig(process.env, {
  isPackaged: packaged,
  level,
  version: pkg.version,
  executableName: appConfig.executableName,
});
const upload = resolveSentryUploadConfig(
  process.env,
  appConfig.executableName,
  pkg.version,
  outDir,
);
const checks: DoctorCheck[] = [
  ...buildDoctorChecks(process.env, resolved, upload, { strictUpload: release }),
];

if (!offline && resolved.otel.enabled) {
  const targets = buildProbeTargets(resolved.otel);
  if (targets.length === 0) {
    checks.push({ id: 'otel.probe', status: 'skip', message: '没有可探测的 OTLP 端点' });
  } else {
    const probes = await probeOtlpTargets(targets, resolved.otel.headers);
    for (const probe of probes) {
      checks.push({
        id: `otel.probe.${probe.signal}`,
        status: probe.ok ? 'ok' : 'fail',
        message: probe.ok
          ? `${probe.signal} ${probe.url} → HTTP ${String(probe.statusCode)}`
          : `${probe.signal} ${probe.url} → ${probe.message}`,
      });
    }
  }
} else if (offline) {
  checks.push({ id: 'otel.probe', status: 'skip', message: '--offline：跳过网络探测' });
}

const summary = summarizeConfig(resolved, upload);
const failed = hasFailures(checks);

if (json) {
  console.log(JSON.stringify({ config: summary, checks }, null, 2));
} else {
  console.log('[observability-doctor] 生效配置（已脱敏）');
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    `[observability-doctor] 检查（${checks.length} 项，${release ? 'release' : 'local'} 模式）`,
  );
  for (const check of checks) {
    console.log(`  [${check.status}] ${check.id}: ${check.message}`);
  }
}

if (failed) {
  console.error('[observability-doctor] ❌ 存在 fail 项');
  process.exit(1);
}
console.log('[observability-doctor] ✅ 通过');
