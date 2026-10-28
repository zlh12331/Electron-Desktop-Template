// proxy-credentials.ts：代理凭据的加密存储与设置值规范化
// 设计：app_settings 只存 {mode, protocol, host, port, bypass}；认证信息（完整代理 URL）
// 存 safeStorage keychain，渲染层只拿到 hasAuth / authUsername 派生状态，不提供取明文通道。
import { AppError, ErrorCode } from '@code-agent/shared/main';
import { logger } from '../../utils/logger';
import { deleteSecret, getSecret, setSecret } from '../storage/keychain';
import { applyProxyChange } from './proxy-applier';
import { buildProxyUrl, type ProxyConfig, parseProxyConfig } from './proxy-resolver';

/** 代理凭据在 keychain 中的保留键（secrets 域不可见） */
export const PROXY_AUTH_SECRET_KEY = '__proxy_auth';

interface ProxyAuthRecord {
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

/** 两个代理 URL 是否指向同一协议/主机/端口（换主机时必须丢弃旧凭据） */
export function sameProxyEndpoint(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
  } catch {
    return false;
  }
}

async function readProxyAuth(): Promise<ProxyAuthRecord | null> {
  let raw: string | null;
  try {
    raw = await getSecret(PROXY_AUTH_SECRET_KEY);
  } catch (error) {
    logger.warn({ error: String(error) }, '代理凭据读取失败（按未配置处理）');
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'socks5:'
    ) {
      return null;
    }
    if (parsed.username === '' && parsed.password === '') {
      return null;
    }
    return {
      url: raw,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
  } catch {
    return null;
  }
}

async function saveProxyAuth(authUrl: string): Promise<void> {
  try {
    await setSecret(PROXY_AUTH_SECRET_KEY, authUrl);
  } catch (error) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      '系统加密不可用，无法安全保存代理凭据；请改用系统代理或先修复系统密钥库',
      error,
    );
  }
}

async function clearProxyAuth(): Promise<void> {
  await deleteSecret(PROXY_AUTH_SECRET_KEY);
}

/** 当前是否已保存代理凭据（不返回密码） */
export async function getProxyAuthStatus(): Promise<{
  readonly hasAuth: boolean;
  readonly username: string | null;
}> {
  const auth = await readProxyAuth();
  return auth === null
    ? { hasAuth: false, username: null }
    : { hasAuth: true, username: auth.username };
}

/**
 * 规范化代理设置：auth 拆到 keychain，返回可落库的结构化值。
 *
 * - 非 fixed / 字段不完整：清除旧凭据
 * - fixed + 新凭据：保存新凭据
 * - fixed + 无新凭据：同端点保留旧凭据，换端点清除（防凭据发往新主机）
 */
export async function sanitizeProxySetting(value: unknown): Promise<unknown> {
  const cfg = parseProxyConfig(value);
  if (cfg.mode !== 'fixed') {
    await clearProxyAuth();
    return { mode: cfg.mode };
  }
  if (cfg.protocol === undefined || cfg.host === undefined || cfg.port === undefined) {
    await clearProxyAuth();
    return { mode: 'system' };
  }
  if (cfg.auth !== undefined) {
    const authUrl = buildProxyUrl(cfg);
    if (authUrl === undefined) {
      throw new AppError(ErrorCode.INVALID_INPUT, '代理地址不完整，无法保存凭据');
    }
    await saveProxyAuth(authUrl);
  } else {
    const existing = await readProxyAuth();
    const endpoint = buildProxyUrl(cfg);
    if (existing !== null && endpoint !== undefined && !sameProxyEndpoint(existing.url, endpoint)) {
      await clearProxyAuth();
    }
  }
  return {
    mode: 'fixed',
    protocol: cfg.protocol,
    host: cfg.host,
    port: cfg.port,
    ...(cfg.bypass !== undefined && cfg.bypass.length > 0 ? { bypass: cfg.bypass } : {}),
  };
}

/** 给渲染层的派生状态：hasAuth / authUsername，不包含凭据本身 */
export async function enrichProxySetting(value: unknown): Promise<unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const cfg = parseProxyConfig(value);
  const status =
    cfg.mode === 'fixed' ? await getProxyAuthStatus() : { hasAuth: false, username: null };
  return {
    ...(value as Record<string, unknown>),
    hasAuth: status.hasAuth,
    ...(status.username !== null ? { authUsername: status.username } : {}),
  };
}

/** 解析运行时配置：设置端点与 keychain 凭据同端点时，把凭据注入运行时配置 */
export async function resolveProxyRuntimeConfig(raw: unknown): Promise<ProxyConfig> {
  const cfg = parseProxyConfig(raw);
  if (cfg.mode !== 'fixed') {
    return cfg;
  }
  const auth = await readProxyAuth();
  if (auth === null) {
    return cfg;
  }
  const endpoint = cfgEndpoint(cfg);
  if (endpoint !== '' && sameProxyEndpoint(endpoint, auth.url)) {
    return {
      ...cfg,
      auth: { username: auth.username, password: auth.password },
    };
  }
  return cfg;
}

function cfgEndpoint(cfg: ProxyConfig): string {
  const { auth: _auth, ...withoutAuth } = cfg;
  return buildProxyUrl(withoutAuth) ?? '';
}

/** 应用设置中的代理（含 keychain 凭据） */
export async function applyProxySetting(raw: unknown): Promise<void> {
  await applyProxyChange(await resolveProxyRuntimeConfig(raw));
}

/** 清除代理凭据（secrets 域不可见；仅代理设置/重置路径调用） */
export async function clearProxyAuthCredentials(): Promise<void> {
  await clearProxyAuth();
}

/**
 * 旧数据迁移：旧版 URL 形态 → 结构化字段 + keychain。
 *
 * 返回规范化后的设置值；调用方负责与旧值比较后写回。加密不可用时抛错，
 * 由调用方决定是否保留旧值并告警（不阻断启动）。
 */
export async function migrateProxyCredentials(raw: unknown): Promise<unknown> {
  return sanitizeProxySetting(raw);
}
