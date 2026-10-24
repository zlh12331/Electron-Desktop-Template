// proxy.handler.ts：proxy 域 IPC——代理连通性测试（设置面「测试连接」按钮）
import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';
import { t } from '../infra/i18n';
import { proxiedFetch, setProxyFetchConfig } from '../infra/network/proxied-fetch';
import {
  applyProxySetting,
  clearProxyAuthCredentials,
  enrichProxySetting,
  resolveProxyRuntimeConfig,
} from '../infra/network/proxy-credentials';
import { readSetting } from '../infra/storage/settings-pref';
import { broadcastSettingChanged } from '../main-events';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

// 探针 3 秒超时：测试交互不等慢代理；目标默认 gstatic 204 探针（轻量、全球可达、无业务含义）
const PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_PROBE_TARGET = 'https://www.gstatic.com/generate_204';

/** 依赖注入工厂（无外部依赖——直接读设置与全局 fetch 配置） */
export function createProxyHandlers(): InferHandlers<
  typeof IPC_DEFINITIONS,
  IpcHandlerContext
>['proxy'] {
  return {
    test: async (input) => {
      // 先把待测配置装进全局 fetch（即测即用），keychain 凭据同端点时注入运行时 URL
      const cfg = await resolveProxyRuntimeConfig(readSetting('proxy'));
      setProxyFetchConfig(cfg);
      if (cfg.mode !== 'fixed' || cfg.url === undefined) {
        logger.info({ mode: cfg.mode }, '代理连通性测试跳过（非 fixed 模式）');
        return {
          ok: false,
          kind: 'not-applicable',
          message: t('proxy.notApplicable'),
        };
      }
      const target = input?.targetUrl ?? DEFAULT_PROBE_TARGET;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('timeout'), PROBE_TIMEOUT_MS);
      try {
        await proxiedFetch(target, {
          signal: controller.signal,
        });
        logger.info({ mode: cfg.mode }, '代理连通性测试通过');
        return { ok: true, kind: 'ok' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 不记录目标 URL（可能是用户输入，且可能含查询参数）
        logger.warn({ mode: cfg.mode, kind: 'target-unreachable' }, '代理连通性测试失败');
        return { ok: false, kind: 'target-unreachable', message };
      } finally {
        clearTimeout(timer);
      }
    },

    clearAuth: async () => {
      await clearProxyAuthCredentials();
      const current = readSetting('proxy');
      await applyProxySetting(current);
      broadcastSettingChanged('proxy', await enrichProxySetting(current));
      logger.info({}, '代理凭据已清除');
      return { ok: true };
    },
  };
}
