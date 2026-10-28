// proxy.handler.ts：proxy 域 IPC——连通性测试 / 系统代理检测 / 清除凭据

import net from 'node:net';
import { performance } from 'node:perf_hooks';
import type {
  InferHandlers,
  IPC_DEFINITIONS,
  ProxyDetectSystemRes,
  ProxyProtocol,
  ProxyTestKind,
  ProxyTestReq,
  ProxyTestRes,
} from '@code-agent/shared/main';
import { session } from 'electron';
import { t } from '../infra/i18n';
import { fetchViaProxy, setProxyFetchConfig } from '../infra/network/proxied-fetch';
import {
  applyProxySetting,
  clearProxyAuthCredentials,
  enrichProxySetting,
  resolveProxyRuntimeConfig,
  sameProxyEndpoint,
} from '../infra/network/proxy-credentials';
import {
  buildProxyUrl,
  maskProxyUrl,
  type ProxyConfig,
  parseProxyConfig,
} from '../infra/network/proxy-resolver';
import { readSetting } from '../infra/storage/settings-pref';
import { broadcastSettingChanged } from '../main-events';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

// 探针 3 秒超时：测试交互不等慢代理；默认 gstatic 204 探针（轻量、无业务含义），
// 中国大陆等网络可通过 input.targetUrl 指定可达目标，避免把 Google 的连通性误判成代理故障。
const PROBE_TIMEOUT_MS = 3_000;
const TCP_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_PROBE_TARGET = 'https://www.gstatic.com/generate_204';
const SYSTEM_PROBE_PARTITION = 'proxy-system-probe';

interface TcpSocketLike {
  once(event: 'connect' | 'error', listener: () => void): TcpSocketLike;
  destroy(): void;
}

type TcpConnect = (options: { host: string; port: number }) => TcpSocketLike;

/** proxy handler 依赖注入（测试用 fake TCP 连接器；生产默认 node:net.connect） */
export interface ProxyHandlerDeps {
  readonly connect?: TcpConnect;
}

const defaultConnect: TcpConnect = (options) => net.connect(options);

/** 依赖注入工厂（无外部依赖——直接读设置与网络栈） */
export function createProxyHandlers(
  deps: ProxyHandlerDeps = {},
): InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['proxy'] {
  const connect = deps.connect ?? defaultConnect;
  return {
    test: async (input) => {
      const cfg = await resolveTestConfig(input, readSetting('proxy'));
      if (cfg === null) {
        logger.info({}, '代理连通性测试跳过（非 fixed 模式）');
        return {
          ok: false,
          kind: 'not-applicable',
          message: t('proxy.notApplicable'),
        };
      }
      return probeProxy(cfg, input?.targetUrl, connect);
    },

    detectSystem: async () => {
      try {
        const probeSession = session.fromPartition(SYSTEM_PROBE_PARTITION, { cache: false });
        await probeSession.setProxy({ mode: 'system' });
        const raw = await probeSession.resolveProxy(DEFAULT_PROBE_TARGET);
        const result = parseSystemProxyResult(raw);
        logger.info(
          { detected: result.detected, protocol: result.protocol ?? null },
          '系统代理检测完成',
        );
        return result;
      } catch (error) {
        logger.warn({ error: String(error) }, '系统代理检测失败');
        return { detected: false };
      }
    },

    clearAuth: async () => {
      await clearProxyAuthCredentials();
      const current = readSetting('proxy');
      await applyProxySetting(current);
      broadcastSettingChanged('proxy', await enrichProxySetting(current));
      logger.info({}, '代理凭据已清除');
      return { ok: true };
    },
  };
}

type CompleteProxyConfig = ProxyConfig & {
  readonly protocol: ProxyProtocol;
  readonly host: string;
  readonly port: number;
};

async function resolveTestConfig(
  input: ProxyTestReq | undefined,
  savedRaw: unknown,
): Promise<CompleteProxyConfig | null> {
  const draft = input?.config;
  const complete = completeFixedConfig(parseProxyConfig(draft ?? savedRaw));
  if (complete === null) {
    return null;
  }
  if (draft === undefined) {
    // 测试已保存配置时顺便把全局 Node 侧配置对齐（保存路径通常已应用）
    setProxyFetchConfig(complete);
    return complete;
  }
  if (complete.auth !== undefined) {
    return complete;
  }
  // 草稿没带密码：同端点沿用 keychain 中已保存的凭据
  return withSavedAuth(complete, savedRaw);
}

function completeFixedConfig(cfg: ProxyConfig): CompleteProxyConfig | null {
  if (
    cfg.mode !== 'fixed' ||
    cfg.protocol === undefined ||
    cfg.host === undefined ||
    cfg.port === undefined
  ) {
    return null;
  }
  return cfg as CompleteProxyConfig;
}

async function probeProxy(
  cfg: CompleteProxyConfig,
  targetUrl: string | undefined,
  connect: TcpConnect,
): Promise<ProxyTestRes> {
  const target = targetUrl ?? DEFAULT_PROBE_TARGET;
  const startedAt = performance.now();
  if (!(await probeTcp(cfg.host, cfg.port, TCP_PROBE_TIMEOUT_MS, connect))) {
    const latencyMs = Math.round(performance.now() - startedAt);
    logger.warn({ protocol: cfg.protocol, kind: 'proxy-unreachable' }, '代理连通性测试失败');
    return { ok: false, kind: 'proxy-unreachable', latencyMs };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchViaProxy(cfg, target, { signal: controller.signal });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (response.status === 407) {
      logger.warn({ protocol: cfg.protocol, kind: 'auth-failed' }, '代理认证失败');
      return { ok: false, kind: 'auth-failed', latencyMs };
    }
    logger.info({ protocol: cfg.protocol, latencyMs }, '代理连通性测试通过');
    return { ok: true, kind: 'ok', latencyMs };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const kind = classifyTestError(error, controller.signal.aborted);
    logger.warn({ protocol: cfg.protocol, kind }, '代理连通性测试失败');
    return { ok: false, kind, message: safeMessage(error), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

async function withSavedAuth(
  cfg: CompleteProxyConfig,
  savedRaw: unknown,
): Promise<CompleteProxyConfig> {
  const saved = await resolveProxyRuntimeConfig(savedRaw);
  if (saved.mode !== 'fixed' || saved.auth === undefined) {
    return cfg;
  }
  const draftUrl = buildProxyUrl(cfg);
  const savedUrl = buildProxyUrl(saved);
  if (draftUrl !== undefined && savedUrl !== undefined && sameProxyEndpoint(draftUrl, savedUrl)) {
    return { ...cfg, auth: saved.auth };
  }
  return cfg;
}

function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
  connect: TcpConnect,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      socket.destroy();
      resolve(ok);
    };
    timer = setTimeout(() => settle(false), timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

function classifyTestError(error: unknown, timedOut: boolean): ProxyTestKind {
  if (timedOut) {
    return 'timeout';
  }
  const causeCode = (error as { cause?: { code?: string } }).cause?.code;
  const text = error instanceof Error ? `${error.message} ${causeCode ?? ''}` : String(error);
  if (/PROXY_AUTH|ProxyAuthentication|407|proxy authentication/i.test(text)) {
    return 'auth-failed';
  }
  if (/UND_ERR_SOCKS5|Socks5ProxyError|SOCKS5/i.test(text)) {
    return 'proxy-unreachable';
  }
  if (/ERR_PROXY|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(text)) {
    return 'proxy-unreachable';
  }
  return 'target-unreachable';
}

function safeMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return maskProxyUrl(text);
}

function parseSystemProxyResult(raw: string): ProxyDetectSystemRes {
  for (const rawEntry of raw.split(';')) {
    const entry = rawEntry.trim();
    if (entry === '' || entry === 'DIRECT') {
      continue;
    }
    const parsed = parseSystemProxyEntry(entry);
    if (parsed !== null) {
      return { detected: true, ...parsed };
    }
  }
  return { detected: false };
}

interface SystemProxyEndpoint {
  readonly protocol: ProxyProtocol;
  readonly host: string;
  readonly port: number;
}

function parseSystemProxyEntry(entry: string): SystemProxyEndpoint | null {
  const match = /^(PROXY|HTTP|HTTPS|SOCKS5|SOCKS|SOCKS4)\s+(.+)$/i.exec(entry);
  if (match === null) {
    return null;
  }
  const protocol = systemProxyProtocol((match[1] ?? '').toUpperCase());
  if (protocol === null) {
    return null;
  }
  const endpoint = splitHostPort(match[2] ?? '');
  if (endpoint === null) {
    return null;
  }
  const port = endpoint.port ?? defaultProxyPort(protocol);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { protocol, host: endpoint.host, port };
}

function systemProxyProtocol(token: string): ProxyProtocol | null {
  switch (token) {
    case 'HTTPS':
      return 'https';
    case 'SOCKS':
    case 'SOCKS5':
      return 'socks5';
    case 'PROXY':
    case 'HTTP':
      return 'http';
    default:
      if (token === 'SOCKS4') {
        logger.warn({}, '系统代理为 SOCKS4，暂不支持导入');
      }
      return null;
  }
}

function splitHostPort(value: string): { host: string; port?: number } | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end < 0) {
      return null;
    }
    const host = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : undefined;
    return host === '' ? null : { host, ...(port !== undefined ? { port } : {}) };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon > 0 && trimmed.split(':').length === 2 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    return { host: trimmed.slice(0, colon), port: Number(trimmed.slice(colon + 1)) };
  }
  return { host: trimmed };
}

function defaultProxyPort(protocol: 'http' | 'https' | 'socks5'): number {
  if (protocol === 'https') {
    return 443;
  }
  return protocol === 'socks5' ? 1080 : 80;
}
