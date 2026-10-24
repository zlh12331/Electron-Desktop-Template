// proxy-applier.ts：代理变更的统一应用口——
// Node fetch 配置 → Chromium 三分区 → env 侧通道，一条链全改完
import { session } from 'electron';
import { reportError } from '../../utils/error-report';
import { logger } from '../../utils/logger';
import { setProxyFetchConfig } from './proxied-fetch';
import {
  buildChromiumProxyConfig,
  buildProxyUrl,
  maskProxyUrl,
  parseProxyConfig,
} from './proxy-resolver';

// updater 用独立分区（实测：主分区代理不影响它）——两处都要各设一遍
const UPDATER_PARTITION = 'electron-updater';

/**
 * 应用代理变更（启动序列与 settings:set:proxy 都走这里）
 *
 * 顺序敏感：先 setProxyFetchConfig 写 Node 侧配置，再改 Chromium 分区——两侧都要在新请求前就位
 */
export async function applyProxyChange(raw: unknown): Promise<void> {
  const cfg = parseProxyConfig(raw);
  setProxyFetchConfig(cfg);
  await applyChromiumSessions(cfg);
  applyEnvSideChannel(cfg);
  logger.info(
    { mode: cfg.mode, ...(cfg.url !== undefined ? { url: maskProxyUrl(cfg.url) } : {}) },
    '代理配置已应用',
  );
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

// env 侧通道：部分依赖库（未走 electron session 的）只认 HTTP(S)_PROXY 环境变量——
// 大小写各写一遍（不同库读法不同）；非 fixed 模式清空，避免残留旧代理
function applyEnvSideChannel(cfg: ReturnType<typeof parseProxyConfig>): void {
  const keys = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
  ] as const;
  const proxyUrl = buildProxyUrl(cfg);
  if (proxyUrl === undefined) {
    for (const key of keys) {
      delete process.env[key];
    }
    return;
  }
  process.env['HTTPS_PROXY'] = proxyUrl;
  process.env['https_proxy'] = proxyUrl;
  process.env['HTTP_PROXY'] = proxyUrl;
  process.env['http_proxy'] = proxyUrl;
  process.env['NO_PROXY'] = 'localhost,127.0.0.1,::1';
  process.env['no_proxy'] = 'localhost,127.0.0.1,::1';
}
