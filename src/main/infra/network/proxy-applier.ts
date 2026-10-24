// proxy-applier.ts：代理变更的统一应用口——
// Node fetch 配置 → Chromium 三分区 → env 侧通道，一条链全改完
import {
  type AuthenticationResponseDetails,
  type AuthInfo,
  app,
  type Event,
  session,
  type WebContents,
} from 'electron';
import { reportError } from '../../utils/error-report';
import { logger } from '../../utils/logger';
import { setProxyFetchConfig } from './proxied-fetch';
import {
  buildChromiumProxyConfig,
  buildProxyUrl,
  maskProxyUrl,
  normalizeProxyHost,
  type ProxyAuth,
  parseProxyConfig,
  resolveProxyAuth,
} from './proxy-resolver';

// updater 用独立分区（实测：主分区代理不影响它）——两处都要各设一遍
const UPDATER_PARTITION = 'electron-updater';

// 代理相关环境变量：Node 侧依赖库（非 Electron session）只认这些键；大小写各写一遍
const ENV_PROXY_KEYS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
] as const;

type LoginListener = (
  event: Event,
  webContents: WebContents | null,
  details: AuthenticationResponseDetails,
  authInfo: AuthInfo,
  callback: (username?: string, password?: string) => void,
) => void;

// 首次修改 env 前的原值：system 模式恢复它，避免把启动时继承的企业代理清掉
let envBaseline: Map<string, string | undefined> | null = null;

let activeProxyAuth: ProxyAuth | null = null;

let loginListener: LoginListener | null = null;

/**
 * 应用代理变更（启动序列与 settings:set:proxy 都走这里）
 *
 * 顺序敏感：先 setProxyFetchConfig / 认证监听，再改 Chromium 分区——两侧都要在新请求前就位
 */
export async function applyProxyChange(raw: unknown): Promise<void> {
  const cfg = parseProxyConfig(raw);
  setProxyFetchConfig(cfg);
  syncProxyAuth(cfg);
  await applyChromiumSessions(cfg);
  applyEnvSideChannel(cfg);
  logger.info(
    { mode: cfg.mode, ...(cfg.url !== undefined ? { url: maskProxyUrl(cfg.url) } : {}) },
    '代理配置已应用',
  );
}

// fixed 且 URL 内嵌凭据时注册 app login 监听；其余模式移除，避免向非目标代理发送凭据
function syncProxyAuth(cfg: ReturnType<typeof parseProxyConfig>): void {
  activeProxyAuth = cfg.mode === 'fixed' ? resolveProxyAuth(cfg.url) : null;
  if (activeProxyAuth === null) {
    removeLoginListener();
    return;
  }
  if (loginListener !== null) {
    return;
  }
  loginListener = (event, _webContents, _details, authInfo, callback) => {
    const auth = activeProxyAuth;
    if (
      !authInfo.isProxy ||
      auth === null ||
      normalizeProxyHost(authInfo.host) !== auth.host ||
      authInfo.port !== auth.port
    ) {
      callback();
      return;
    }
    event.preventDefault();
    callback(auth.username, auth.password);
  };
  app.on('login', loginListener);
}

function removeLoginListener(): void {
  if (loginListener !== null) {
    app.removeListener('login', loginListener);
    loginListener = null;
  }
}

async function applyChromiumSessions(cfg: ReturnType<typeof parseProxyConfig>): Promise<void> {
  const proxyConfig = buildChromiumProxyConfig(cfg);
  const targets: readonly [string, ReturnType<typeof session.fromPartition>][] = [
    ['default', session.defaultSession],
    ['electron-updater', session.fromPartition(UPDATER_PARTITION, { cache: false })],
  ];
  for (const [name, ses] of targets) {
    try {
      await ses.setProxy(proxyConfig);
    } catch (err) {
      reportError(err, {
        message: '分区代理设置失败（继续其余分区）',
        fields: { session: name },
        tags: { scope: 'proxy', stage: 'apply', session: name },
      });
    }
  }
}

// env 侧通道：部分依赖库（未走 electron session 的）只认 HTTP(S)_PROXY 环境变量。
// 首次改动前快照原值：system 恢复启动时继承的企业代理，direct 强制清空，fixed 写入新值。
function captureEnvBaseline(): void {
  if (envBaseline !== null) {
    return;
  }
  envBaseline = new Map(ENV_PROXY_KEYS.map((key) => [key, process.env[key]]));
}

function clearProxyEnv(): void {
  for (const key of ENV_PROXY_KEYS) {
    delete process.env[key];
  }
}

function restoreEnvBaseline(): void {
  if (envBaseline === null) {
    return;
  }
  for (const [key, value] of envBaseline) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // 恢复后清除基线：后续再次改代理时以当前（已恢复的）环境为新基线
  envBaseline = null;
}

function applyEnvSideChannel(cfg: ReturnType<typeof parseProxyConfig>): void {
  const proxyUrl = buildProxyUrl(cfg);
  if (proxyUrl !== undefined) {
    captureEnvBaseline();
    process.env['HTTPS_PROXY'] = proxyUrl;
    process.env['https_proxy'] = proxyUrl;
    process.env['HTTP_PROXY'] = proxyUrl;
    process.env['http_proxy'] = proxyUrl;
    process.env['NO_PROXY'] = 'localhost,127.0.0.1,::1';
    process.env['no_proxy'] = 'localhost,127.0.0.1,::1';
    return;
  }
  if (cfg.mode === 'direct') {
    // direct 必须强制直连，不能保留继承的代理变量
    captureEnvBaseline();
    clearProxyEnv();
    return;
  }
  // system：未改动过则原样保留继承 env；曾经改动过则恢复快照
  restoreEnvBaseline();
}

/**
 * 测试专用：清空代理 env 基线、认证监听与当前认证信息
 *
 * 模块级状态不能跨用例泄漏；生产代码不得调用。
 */
export function resetProxyApplierForTests(): void {
  envBaseline = null;
  activeProxyAuth = null;
  removeLoginListener();
  clearProxyEnv();
}
