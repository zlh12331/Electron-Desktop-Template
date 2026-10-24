// otlp-probe.ts：OTLP 端点连通性探测（只发空载荷，验证可达/鉴权，不产生业务数据）
// 运行时设置页与 scripts/observability-doctor 共用；调用方负责超时/展示脱敏

/** 探测目标 */
export interface OtlpProbeTarget {
  readonly signal: 'traces' | 'metrics' | 'logs';
  readonly url: string;
}

/** 探测结果 */
export interface OtlpProbeResult extends OtlpProbeTarget {
  readonly ok: boolean;
  readonly statusCode: number | null;
  readonly message: string;
}

const PROBE_TIMEOUT_MS = 3_000;

const EMPTY_PAYLOADS = {
  traces: '{"resourceSpans":[]}',
  metrics: '{"resourceMetrics":[]}',
  logs: '{"resourceLogs":[]}',
} as const;

/** 展示用 URL：去掉 query（可能含 token） */
export function safeDisplayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.search !== '') {
      url.search = '?redacted';
    }
    return url.toString();
  } catch {
    return raw;
  }
}

async function probeOne(
  target: OtlpProbeTarget,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<OtlpProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: EMPTY_PAYLOADS[target.signal],
      signal: controller.signal,
    });
    await response.text().catch(() => '');
    return {
      ...target,
      url: safeDisplayUrl(target.url),
      ok: response.ok,
      statusCode: response.status,
      message: response.ok ? 'reachable' : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ...target,
      url: safeDisplayUrl(target.url),
      ok: false,
      statusCode: null,
      message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 并发探测全部目标（空数组直接返回空结果） */
export async function probeOtlpTargets(
  targets: readonly OtlpProbeTarget[],
  headers: Readonly<Record<string, string>> = {},
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<readonly OtlpProbeResult[]> {
  return await Promise.all(targets.map((target) => probeOne(target, headers, timeoutMs)));
}
