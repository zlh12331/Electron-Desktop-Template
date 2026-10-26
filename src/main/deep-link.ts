// deep-link.ts：自定义协议解析与分发——注册系统协议客户端、解析深链（/open/<id> 为示例实体路径）、向渲染层广播
// 边界：不做窗口管理；scheme 常量来自 app.config.json → constants/brand.ts，须与 electron-builder.yml 一致
import type { DeepLinkPayload } from '@code-agent/shared/main';

import { APP_PROTOCOL, IPC_CHANNELS } from '@code-agent/shared/main';
import { app, BrowserWindow } from 'electron';

import { logger } from './utils/logger';

/** 协议 scheme（注册与提取共用；真源 app.config.json → constants/brand.ts） */
const APP_DEEP_LINK_PROTOCOL = APP_PROTOCOL;

/** 协议前缀（URL scheme 大小写不敏感，提取时按小写比较） */
const DEEP_LINK_PREFIX = `${APP_DEEP_LINK_PROTOCOL}://`;

// 实体 id 契约：URL 路径段解码后只接受常见安全字符，避免任意串进入路由/日志
const TARGET_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

// 冷启动时渲染层尚未订阅，事件会丢；先暂存，由渲染层挂载后主动取走
let pendingDeepLink: DeepLinkPayload | null = null;

/**
 * 解析深链 URL 为载荷：优先取路径段 /open/:id，回退查询参数 target；两者皆无则 targetId 为 null
 *
 * 非法/超长/含非白名单字符的 id 按「仅唤起」处理，不把任意字符串交给业务层。
 *
 * @param rawUrl 原始 URL（无法 parse 时原样带回，targetId 为 null）
 */
export function parseDeepLink(rawUrl: string): DeepLinkPayload {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { targetId: null, url: rawUrl };
  }
  // 自定义 scheme 的 URL 解析：`scheme://open/<id>` 会把 open 当 host，
  // 只有 `scheme:///open/<id>` 才落在 pathname，两种写法都要识别。
  const targetMatch =
    /\/open\/([^/?#]+)/.exec(url.pathname) ??
    (url.host.toLowerCase() === 'open' ? /^\/([^/?#]+)/.exec(url.pathname) : null);
  const rawTargetId = targetMatch?.[1] ?? url.searchParams.get('target');
  return { targetId: normalizeTargetId(rawTargetId), url: rawUrl };
}

function normalizeTargetId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return TARGET_ID_PATTERN.test(decoded) ? decoded : null;
}

/** 暂存冷启动深链，等待渲染层就绪后取走（重复设置以最后一次为准） */
export function setPendingDeepLink(payload: DeepLinkPayload): void {
  pendingDeepLink = payload;
}

/** 取走并清空暂存深链；无暂存返回 null（渲染层挂载时调用） */
export function takePendingDeepLink(): DeepLinkPayload | null {
  const payload = pendingDeepLink;
  pendingDeepLink = null;
  return payload;
}

/** 清空暂存（测试用；生产不调用） */
export function clearPendingDeepLink(): void {
  pendingDeepLink = null;
}

/**
 * 从进程启动参数 argv 提取第一个协议 URL
 *
 * Windows/Linux 没有 open-url 事件，冷启动深链只能从 argv 里找
 */
export function extractProtocolUrl(argv: readonly string[]): string | null {
  const prefix = DEEP_LINK_PREFIX.toLowerCase();
  return argv.find((arg) => arg.toLowerCase().startsWith(prefix)) ?? null;
}

/**
 * 向所有存活窗口广播深链事件（接入业务后可复用同一通道做实体导航）
 */
export function broadcastDeepLink(payload: DeepLinkPayload): void {
  const channel = IPC_CHANNELS['APP_EVENT_DEEP_LINK'];
  let delivered = 0;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
      delivered += 1;
    }
  }
  // 只记 targetId 是否存在，不落完整 URL（深链可能带第三方参数）
  if (delivered === 0) {
    logger.warn({ hasTarget: payload.targetId !== null }, '深链到达但无可用窗口，事件未投递');
    return;
  }
  logger.info({ hasTarget: payload.targetId !== null, windows: delivered }, '深链事件已广播');
}

/**
 * 注册为系统默认协议客户端
 *
 * dev 模式（process.defaultApp）必须显式传可执行文件路径与入口脚本两个参数，
 * 否则 OS 注册的是 electron 二进制本身，拉起后拿不到应用入口
 */
export function registerDeepLinkProtocol(): boolean {
  if (process.defaultApp && process.argv.length >= 2) {
    return app.setAsDefaultProtocolClient(APP_DEEP_LINK_PROTOCOL, process.execPath, [
      process.argv[1] ?? '',
    ]);
  }
  return app.setAsDefaultProtocolClient(APP_DEEP_LINK_PROTOCOL);
}
