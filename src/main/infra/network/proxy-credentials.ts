// proxy-credentials.ts：代理凭据的加密存储与设置值规范化
// 设计：app_settings 只存无凭据 URL；用户名/密码（完整代理 URL）存 safeStorage keychain，
// 渲染层只拿到 hasAuth / authUsername 派生状态，不提供取明文通道。
import { AppError, ErrorCode } from '@code-agent/shared/main';
import { logger } from '../../utils/logger';
import { deleteSecret, getSecret, setSecret } from '../storage/keychain';
import { applyProxyChange } from './proxy-applier';
import { type ProxyConfig, parseProxyConfig } from './proxy-resolver';

/** 代理凭据在 keychain 中的保留键（secrets 域不可见） */
export const PROXY_AUTH_SECRET_KEY = '__proxy_auth';

interface ProxySettingsShape {
  readonly mode?: unknown;
  readonly url?: unknown;
  readonly bypass?: unknown;
}

interface ProxyAuthRecord {
  readonly url: string;
  readonly username: string;
}

/** 从 URL 提取凭据；无凭据或非法 URL 返回 null */
export function extractProxyCredentials(
  url: string,
): { readonly sanitizedUrl: string; readonly authUrl: string; readonly username: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username === '' && parsed.password === '') {
    return null;
  }
  // 用正则剥掉 userinfo，避免 URL.toString() 对路径/尾斜杠做额外归一化
  const sanitizedUrl = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, '$1');
  return {
    sanitizedUrl,
    authUrl: url,
    username: decodeURIComponent(parsed.username),
  };
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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username === '' && parsed.password === '') {
      return null;
    }
    return { url: raw, username: decodeURIComponent(parsed.username) };
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
 * 规范化代理设置：拆出 URL 内嵌凭据存入 keychain，返回可落库的无凭据值。
 *
 * - 非 fixed / 缺 URL：清除旧凭据
 * - fixed + 新 URL 带凭据：保存新凭据
 * - fixed + 新 URL 不带凭据：同端点保留旧凭据，换端点清除（防凭据发往新主机）
 */
export async function sanitizeProxySetting(value: unknown): Promise<unknown> {
  const cfg = parseProxyConfig(value);
  if (cfg.mode !== 'fixed' || cfg.url === undefined) {
    await clearProxyAuth();
    return { mode: cfg.mode };
  }

  const extracted = extractProxyCredentials(cfg.url);
  if (extracted !== null) {
    await saveProxyAuth(extracted.authUrl);
    return {
      mode: 'fixed',
      url: extracted.sanitizedUrl,
      ...(cfg.bypass !== undefined && cfg.bypass.length > 0 ? { bypass: cfg.bypass } : {}),
    };
  }

  const existing = await readProxyAuth();
  if (existing !== null && !sameProxyEndpoint(existing.url, cfg.url)) {
    await clearProxyAuth();
  }
  return {
    mode: 'fixed',
    url: cfg.url,
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
    ...(value as ProxySettingsShape),
    hasAuth: status.hasAuth,
    ...(status.username !== null ? { authUsername: status.username } : {}),
  };
}

/** 解析运行时配置：settings URL 与 keychain 凭据同端点时，把凭据注入运行时 URL */
export async function resolveProxyRuntimeConfig(raw: unknown): Promise<ProxyConfig> {
  const cfg = parseProxyConfig(raw);
  if (cfg.mode !== 'fixed' || cfg.url === undefined) {
    return cfg;
  }
  const auth = await readProxyAuth();
  if (auth !== null && sameProxyEndpoint(cfg.url, auth.url)) {
    return { ...cfg, url: auth.url };
  }
  return cfg;
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
 * 旧数据迁移：URL 内嵌凭据 → keychain + 无凭据 URL。
 *
 * 返回规范化后的设置值；调用方负责与旧值比较后写回。加密不可用时抛错，
 * 由调用方决定是否保留旧值并告警（不阻断启动）。
 */
export async function migrateProxyCredentials(raw: unknown): Promise<unknown> {
  return sanitizeProxySetting(raw);
}
