// proxy-resolver.ts：代理配置解析与派生——结构化设置归一、Chromium 规则、绕过判定、URL 脱敏
// 34 号：本文件是纯函数层（无副作用），应用/取 URL 的副作用在 proxy-applier / proxied-fetch
import {
  DEFAULT_PROXY_SETTINGS,
  type ProxyMode,
  type ProxyProtocol,
  ProxySettingInputSchema,
} from '@code-agent/shared/main';
import { z } from 'zod';

import { logger } from '../../utils/logger';

/** 代理认证凭据（keychain 注入的运行时值；不落 app_settings） */
interface ProxyAuthCredentials {
  readonly username: string;
  readonly password: string;
}

/** 代理运行时配置：结构化设置 + 可选凭据（凭据只存在于运行时） */
export interface ProxyConfig {
  readonly mode: ProxyMode;
  readonly protocol?: ProxyProtocol;
  readonly host?: string;
  readonly port?: number;
  readonly bypass?: readonly string[];
  /** 运行时凭据（keychain 注入；落库值不含） */
  readonly auth?: ProxyAuthCredentials;
}

/** Chromium login 事件用：代理端点 + 凭据（仅 host/port 匹配的挑战才应答） */
export interface ProxyAuth extends ProxyAuthCredentials {
  readonly host: string;
  readonly port: number;
}

const ProxyConfigSchema = z.object({
  mode: z.enum(['system', 'direct', 'fixed']),
  protocol: z.enum(['http', 'https', 'socks5']).optional(),
  host: z.string().min(1).max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  bypass: z.array(z.string().min(1).max(253)).max(64).optional(),
  auth: z.object({ username: z.string().max(256), password: z.string().max(1024) }).optional(),
  /** 旧版单 URL 形态（启动迁移/旧 keychain 数据兼容） */
  url: z.string().min(1).max(2048).optional(),
});

const SYSTEM_DEFAULT: ProxyConfig = { mode: DEFAULT_PROXY_SETTINGS.mode };

/** 解析设置原始值（用户可控面）：损坏/fixed 缺字段一律回落 system 兜底并告警 */
export function parseProxyConfig(raw: unknown): ProxyConfig {
  if (raw === undefined || raw === null) {
    return { ...SYSTEM_DEFAULT };
  }
  const parsed = ProxyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ error: parsed.error.message }, '代理配置解析失败，按 system 兜底');
    return { ...SYSTEM_DEFAULT };
  }
  const data = parsed.data;
  if (data.mode !== 'fixed') {
    return { mode: data.mode };
  }
  const normalized = normalizeFixedConfig(data);
  if (normalized === null) {
    logger.warn({ protocol: data.protocol ?? null }, '代理配置不完整，按 system 兜底');
    return { ...SYSTEM_DEFAULT };
  }
  return normalized;
}

function normalizeFixedConfig(data: z.infer<typeof ProxyConfigSchema>): ProxyConfig | null {
  const bypass = normalizeBypass(data.bypass);
  if (data.url !== undefined && data.host === undefined) {
    return normalizeLegacyConfig(data.url, bypass);
  }
  return normalizeStructuredConfig(data, bypass);
}

function normalizeLegacyConfig(
  url: string,
  bypass: readonly string[] | undefined,
): ProxyConfig | null {
  const legacy = parseLegacyProxyUrl(url);
  if (legacy === null) {
    return null;
  }
  const auth = dropSocks5Auth(legacy.protocol, legacy.auth);
  const { auth: _legacyAuth, ...legacyWithoutAuth } = legacy;
  return validateFixedConfig({
    ...legacyWithoutAuth,
    ...(auth !== undefined ? { auth } : {}),
    ...(bypass !== undefined ? { bypass } : {}),
  });
}

function normalizeStructuredConfig(
  data: z.infer<typeof ProxyConfigSchema>,
  bypass: readonly string[] | undefined,
): ProxyConfig | null {
  const { protocol, host, port } = data;
  if (protocol === undefined || host === undefined || port === undefined) {
    return null;
  }
  const normalizedHost = normalizeProxyHost(host);
  if (normalizedHost === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  const auth = dropSocks5Auth(protocol, data.auth);
  return validateFixedConfig({
    mode: 'fixed',
    protocol,
    host: normalizedHost,
    port,
    ...(bypass !== undefined ? { bypass } : {}),
    ...(auth !== undefined ? { auth } : {}),
  });
}

function dropSocks5Auth(
  protocol: ProxyProtocol | undefined,
  auth: ProxyAuthCredentials | undefined,
): ProxyAuthCredentials | undefined {
  if (auth === undefined) {
    return undefined;
  }
  if (protocol === 'socks5') {
    logger.warn({}, 'SOCKS5 认证不受 Chromium 支持，已忽略代理凭据');
    return undefined;
  }
  return auth;
}

function validateFixedConfig(candidate: ProxyConfig): ProxyConfig | null {
  const { auth, ...withoutAuth } = candidate;
  const validated = ProxySettingInputSchema.safeParse({
    ...withoutAuth,
    ...(auth !== undefined ? { auth } : {}),
  });
  if (!validated.success) {
    logger.warn({ error: validated.error.message }, '代理字段校验失败，按 system 兜底');
    return null;
  }
  return candidate;
}

function parseLegacyProxyUrl(url: string): ProxyConfig | null {
  const parsed = safeParseUrl(url);
  if (parsed === null) {
    return null;
  }
  const protocol = protocolFromUrl(parsed);
  const host = normalizeProxyHost(parsed.hostname);
  if (protocol === null || host === '') {
    return null;
  }
  const port = portFromUrl(parsed, protocol);
  if (port === null) {
    return null;
  }
  const auth = authFromUrl(parsed);
  return {
    mode: 'fixed',
    protocol,
    host,
    port,
    ...(auth !== undefined ? { auth } : {}),
  };
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function protocolFromUrl(parsed: URL): ProxyProtocol | null {
  switch (parsed.protocol) {
    case 'http:':
      return 'http';
    case 'https:':
      return 'https';
    case 'socks5:':
    case 'socks:':
      return 'socks5';
    default:
      return null;
  }
}

function portFromUrl(parsed: URL, protocol: ProxyProtocol): number | null {
  const port =
    parsed.port !== ''
      ? Number(parsed.port)
      : protocol === 'socks5'
        ? 1080
        : protocol === 'https'
          ? 443
          : 80;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function authFromUrl(parsed: URL): ProxyAuthCredentials | undefined {
  if (parsed.username === '' && parsed.password === '') {
    return undefined;
  }
  return {
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

function normalizeBypass(bypass: readonly string[] | undefined): string[] | undefined {
  if (bypass === undefined) {
    return undefined;
  }
  const unique = new Set<string>();
  for (const raw of bypass) {
    const entry = raw.trim();
    if (entry !== '') {
      unique.add(entry);
    }
  }
  return unique.size > 0 ? [...unique].slice(0, 64) : undefined;
}

/**
 * 派生 Chromium session.setProxy 参数（default/updater 两分区共用一档）
 *
 * HTTP/HTTPS/SOCKS5 都写成单个 proxyURL（对该 URL 的所有 scheme 生效）；
 * bypass 强制 <local>，用户列表按 Chromium 规则原样传入（支持 CIDR/通配）。
 */
export function buildChromiumProxyConfig(cfg: ProxyConfig): {
  mode: 'system' | 'direct' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
} {
  if (cfg.mode === 'system') {
    return { mode: 'system' };
  }
  if (cfg.mode === 'direct') {
    return { mode: 'direct' };
  }
  if (cfg.protocol === undefined || cfg.host === undefined || cfg.port === undefined) {
    return { mode: 'system' };
  }
  const userBypass = cfg.bypass ?? [];
  return {
    mode: 'fixed_servers',
    proxyRules: `${cfg.protocol}://${formatHostForUrl(cfg.host)}:${cfg.port}`,
    proxyBypassRules: ['<local>', ...userBypass].join(';'),
  };
}

/** fixed 模式返回带凭据的代理 URL（keychain / env 侧通道用），其余模式 undefined */
export function buildProxyUrl(cfg: ProxyConfig): string | undefined {
  if (
    cfg.mode !== 'fixed' ||
    cfg.protocol === undefined ||
    cfg.host === undefined ||
    cfg.port === undefined
  ) {
    return undefined;
  }
  const userinfo =
    cfg.auth !== undefined
      ? `${encodeURIComponent(cfg.auth.username)}:${encodeURIComponent(cfg.auth.password)}@`
      : '';
  return `${cfg.protocol}://${userinfo}${formatHostForUrl(cfg.host)}:${cfg.port}`;
}

/** 主机进 URL 前补 IPv6 方括号（`::1` → `[::1]`） */
function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * 请求是否绕过代理（仅 Node 固定代理路径用；Chromium 侧由 proxyBypassRules 处理）
 *
 * 环回地址恒绕过；bypass 支持域名后缀、前导 `*.`/`*`、CIDR 与 `<local>`。
 */
export function shouldBypass(cfg: ProxyConfig, requestUrl: string): boolean {
  if (cfg.mode !== 'fixed') {
    return false;
  }
  let hostname: string;
  try {
    hostname = normalizeProxyHost(new URL(requestUrl).hostname);
  } catch {
    return false;
  }
  if (isLoopbackHost(hostname)) {
    return true;
  }
  for (const raw of cfg.bypass ?? []) {
    if (matchesBypassEntry(hostname, raw)) {
      return true;
    }
  }
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname.startsWith('127.')
  );
}

function matchesBypassEntry(hostname: string, raw: string): boolean {
  let entry = raw.trim().toLowerCase();
  if (entry === '') {
    return false;
  }
  if (entry === '<local>') {
    return isLoopbackHost(hostname);
  }
  entry = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  if (entry.includes('/')) {
    return cidrMatch(hostname, entry);
  }
  entry = entry.replace(/^\*\.?/, '').replace(/^\./, '');
  entry = entry.replace(/:\d+$/, '');
  if (entry === '') {
    return false;
  }
  return hostname === entry || hostname.endsWith(`.${entry}`);
}

interface ParsedIp {
  readonly bits: 32 | 128;
  readonly value: bigint;
}

function cidrMatch(hostname: string, rule: string): boolean {
  const slash = rule.lastIndexOf('/');
  if (slash <= 0) {
    return false;
  }
  const network = rule.slice(0, slash).replace(/^\[|\]$/g, '');
  const prefix = Number(rule.slice(slash + 1));
  const ip = parseIp(hostname);
  const net = parseIp(network);
  if (ip === null || net === null || ip.bits !== net.bits) {
    return false;
  }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > ip.bits) {
    return false;
  }
  const shift = BigInt(ip.bits - prefix);
  return ip.value >> shift === net.value >> shift;
}

function parseIp(value: string): ParsedIp | null {
  if (value.includes(':')) {
    return parseIpv6(value);
  }
  const parts = value.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    result = (result << 8n) | BigInt(octet);
  }
  return { bits: 32, value: result };
}

function parseIpv6(value: string): ParsedIp | null {
  const halves = value.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const tailRaw = halves[1] ?? '';
  const tail = halves.length === 2 && tailRaw !== '' ? tailRaw.split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) {
    return null;
  }
  const groups = [...head, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tail];
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return null;
    }
    result = (result << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return { bits: 128, value: result };
}

/** 日志用脱敏：代理 URL 可能带 `user:pass@` 认证段，替换为 *** */
export function maskProxyUrl(url: string): string {
  return url.replace(/\/\/[^/@]+@/, '//***@');
}

/** 规范化主机名（IPv6 的 URL.hostname 带方括号，Electron AuthInfo.host 不带） */
export function normalizeProxyHost(host: string): string {
  return host
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase();
}

/** 从运行时配置提取 Chromium login 事件所需端点与凭据；无凭据/端点不完整返回 null */
export function resolveProxyAuth(cfg: ProxyConfig): ProxyAuth | null {
  if (
    cfg.mode !== 'fixed' ||
    cfg.auth === undefined ||
    cfg.host === undefined ||
    cfg.port === undefined
  ) {
    return null;
  }
  return {
    host: normalizeProxyHost(cfg.host),
    port: cfg.port,
    username: cfg.auth.username,
    password: cfg.auth.password,
  };
}
