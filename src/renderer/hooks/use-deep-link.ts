import type { DeepLinkPayload } from '@code-agent/shared/renderer';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';

import { ROUTES } from '@/lib/constants';
import { hasIpcBridge, unwrap } from '@/lib/ipc';

/**
 * 深度链接桥接 Hook（AppShell 挂载一次）
 *
 * 收到协议唤起时导航到目标页面。示例切片把 payload.targetId 解析为笔记 id，
 * 直接打开 `/notes/<id>`（目标不存在时页面显示「笔记不存在」）。
 * 接入业务后把这里换成真实的路由解析（例：`/open/<id>` → 打开目标实体）。
 */
export function useDeepLink(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasIpcBridge()) {
      return;
    }

    const handlePayload = (payload: DeepLinkPayload): void => {
      if (payload.targetId === null) {
        return;
      }
      // 深链示例：targetId 视作笔记 id，打开参考切片的详情页
      navigate(ROUTES.note(payload.targetId));
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
