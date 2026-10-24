// deep-link.ts：code-agent:// 协议解析与分发——注册系统协议客户端、解析会话深链、向渲染层广播
// 边界：不做窗口管理；scheme 常量须与 electron-builder.yml 的 protocol 配置保持一致
import type { DeepLinkPayload } from '@code-agent/shared/main';

import { APP_PROTOCOL, IPC_CHANNELS } from '@code-agent/shared/main';
import { app, BrowserWindow } from 'electron';

import { logger } from './utils/logger';

/** 协议 scheme（注册与提取共用；真源 app.config.json → constants/brand.ts） */
const CODE_AGENT_PROTOCOL = APP_PROTOCOL;

/**
 * 解析深链 URL 为载荷：优先取路径段 /session/:id，回退查询参数 session；两者皆无则 sessionId 为 null
 *
 * @param rawUrl 原始 URL（无法 parse 时原样带回，sessionId 为 null）
 */
export function parseDeepLink(rawUrl: string): DeepLinkPayload {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { sessionId: null, url: rawUrl };
  }
  const sessionMatch = /\/session\/([^/?#]+)/.exec(url.pathname);
  const sessionId = sessionMatch?.[1] ?? url.searchParams.get('session');
  return { sessionId: sessionId ?? null, url: rawUrl };
}

/**
 * 从进程启动参数 argv 提取第一个协议 URL
 *
 * Windows/Linux 没有 open-url 事件，冷启动深链只能从 argv 里找
 */
export function extractProtocolUrl(argv: readonly string[]): string | null {
  return argv.find((a) => a.startsWith(`${CODE_AGENT_PROTOCOL}://`)) ?? null;
}

/**
 * 向所有存活窗口广播深链事件（托盘「打开会话」复用同一通道）
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
  // 只记 sessionId 是否存在，不落完整 URL（深链可能带第三方参数）
  if (delivered === 0) {
    logger.warn({ hasSession: payload.sessionId !== null }, '深链到达但无可用窗口，事件未投递');
    return;
  }
  logger.info({ hasSession: payload.sessionId !== null, windows: delivered }, '深链事件已广播');
}

/**
 * 注册为系统默认协议客户端
 *
 * dev 模式（process.defaultApp）必须显式传可执行文件路径与入口脚本两个参数，
 * 否则 OS 注册的是 electron 二进制本身，拉起后拿不到应用入口
 */
export function registerDeepLinkProtocol(): boolean {
  if (process.defaultApp && process.argv.length >= 2) {
    return app.setAsDefaultProtocolClient(CODE_AGENT_PROTOCOL, process.execPath, [
      process.argv[1] ?? '',
    ]);
  }
  return app.setAsDefaultProtocolClient(CODE_AGENT_PROTOCOL);
}
