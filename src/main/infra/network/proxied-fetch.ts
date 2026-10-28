// proxied-fetch.ts：主进程出站请求的代理分流
// fixed 走 undici ProxyAgent（HTTP/HTTPS/SOCKS5 与认证，undici 8.x 原生支持）；
// system/direct 以及 fixed 的 bypass 目标走 Chromium session.fetch（系统代理/PAC 与 bypass 规则）。
import { session } from 'electron';
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from 'undici';

import { buildProxyUrl, type ProxyConfig, shouldBypass } from './proxy-resolver';

// ProxyAgent 按代理 URL 缓存复用（连接池）；配置变更时全量关闭重建
const agentCache = new Map<string, ProxyAgent>();

let currentConfig: ProxyConfig | null = null;

/** 更新全局代理配置（applyProxyChange 调用；null = 未配置态） */
export function setProxyFetchConfig(cfg: ProxyConfig | null): void {
  currentConfig = cfg;
  clearProxyAgents();
}

/** 关闭并清空全部缓存 agent（释放连接池） */
export function clearProxyAgents(): void {
  for (const agent of agentCache.values()) {
    void agent.close().catch(() => {});
  }
  agentCache.clear();
}

function getAgent(proxyUrl: string): ProxyAgent {
  const cached = agentCache.get(proxyUrl);
  if (cached !== undefined) {
    return cached;
  }
  const agent = new ProxyAgent(proxyUrl);
  agentCache.set(proxyUrl, agent);
  return agent;
}

type FetchInput = string | URL;

/**
 * 代理感知 fetch：fixed 且非绕过走 undici ProxyAgent，其余委托 Chromium session.fetch
 * （签名与全局 fetch 对齐，调用方无感切换）
 */
export async function proxiedFetch(
  input: FetchInput,
  init?: Omit<RequestInit, 'dispatcher'>,
): Promise<Response> {
  const url = input instanceof URL ? input.href : input;
  const cfg = currentConfig;
  if (cfg !== null && cfg.mode === 'fixed' && !shouldBypass(cfg, url)) {
    const proxyUrl = buildProxyUrl(cfg);
    if (proxyUrl !== undefined) {
      const agent = getAgent(proxyUrl);
      return undiciFetch(url, {
        ...(init as Record<string, unknown>),
        dispatcher: agent as unknown as Dispatcher,
      }) as unknown as Promise<Response>;
    }
  }
  return session.defaultSession.fetch(url, init as RequestInit);
}

/**
 * 一次性经代理探测（proxy:test 用）：临时 agent、用完即关，不污染全局连接池
 *
 * 只接受 fixed 配置；配置不完整时抛错，由调用方归因。
 */
export async function fetchViaProxy(
  cfg: ProxyConfig,
  input: string,
  init?: Omit<RequestInit, 'dispatcher'>,
): Promise<Response> {
  const proxyUrl = buildProxyUrl(cfg);
  if (proxyUrl === undefined) {
    throw new Error('代理配置不完整');
  }
  const agent = new ProxyAgent(proxyUrl);
  try {
    return (await undiciFetch(input, {
      ...(init as Record<string, unknown>),
      dispatcher: agent as unknown as Dispatcher,
    })) as unknown as Response;
  } finally {
    await agent.close().catch(() => {});
  }
}
