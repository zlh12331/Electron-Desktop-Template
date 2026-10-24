// connectivity.ts：设置页连接测试——把 OTel 配置转成 shared 探测目标

import type { TelemetryOtlpProbe } from '@code-agent/shared/main';
import {
  type OtelResolvedConfig,
  type OtlpProbeTarget,
  probeOtlpTargets,
} from '@code-agent/shared/observability';

/** 按已配置端点并发探测；未配置的信号直接跳过 */
export async function probeOtlpEndpoints(
  config: OtelResolvedConfig,
): Promise<readonly TelemetryOtlpProbe[]> {
  const targets: OtlpProbeTarget[] = [];
  if (config.traceEndpoint !== null) {
    targets.push({ signal: 'traces', url: config.traceEndpoint });
  }
  if (config.metricEndpoint !== null) {
    targets.push({ signal: 'metrics', url: config.metricEndpoint });
  }
  if (config.logEndpoint !== null) {
    targets.push({ signal: 'logs', url: config.logEndpoint });
  }
  const results = await probeOtlpTargets(targets, config.headers);
  return results.map((result) => ({
    signal: result.signal,
    url: result.url,
    ok: result.ok,
    statusCode: result.statusCode,
    message: result.message === 'reachable' ? '可达' : result.message,
  }));
}
