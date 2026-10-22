import type { DeepLinkPayload } from '@code-agent/shared/renderer';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';

import { ROUTES } from '@/lib/constants';
import { hasIpcBridge } from '@/lib/ipc';

/**
 * 深度链接桥接 Hook（AppShell 挂载一次）
 *
 * 收到协议唤起时导航到目标页面。模板版只演示「如何消费深链 payload」：
 * payload.userPath 若命中已注册路由则跳转，否则留驻当前页（窗口已由主进程聚焦）。
 * 接入业务后把这里换成真实的路由解析（例：`/session/<id>` → 打开会话）。
 */
export function useDeepLink(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasIpcBridge()) {
      return;
    }

    const unsubscribe = window.api.app.subscribeDeepLink((payload) => {
      const typedPayload = payload as DeepLinkPayload;
      if (typedPayload.sessionId === null || typedPayload.sessionId === '') {
        return;
      }
      // 深链示例：sessionId 视作目标路径 id，模板内跳转到关于页作为占位
      navigate(ROUTES.about);
    });

    return () => {
      unsubscribe();
    };
  }, [navigate]);
}
