import type { DeepLinkPayload } from '@code-agent/shared/renderer';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';

import { ROUTES } from '@/lib/constants';
import { hasIpcBridge, unwrap } from '@/lib/ipc';

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

    const handlePayload = (payload: DeepLinkPayload): void => {
      if (payload.sessionId === null) {
        return;
      }
      // 深链示例：sessionId 视作目标路径 id，模板内跳转到关于页作为占位
      navigate(ROUTES.about);
    };

    const unsubscribe = window.api.app.subscribeDeepLink((payload) => {
      handlePayload(payload as DeepLinkPayload);
    });

    // 冷启动深链在订阅建立前到达主进程，事件会丢；主动取走暂存值补齐
    void window.api.app
      .takePendingDeepLink()
      .then((response) => {
        const pending = unwrap(response).payload;
        if (pending !== null) {
          handlePayload(pending);
        }
      })
      .catch(() => {
        // 取暂存失败不影响常规事件订阅
      });

    return () => {
      unsubscribe();
    };
  }, [navigate]);
}
