import type { ProxyProtocol, ProxyTestReq } from '@code-agent/shared/renderer';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useErrorMessage, useTranslation } from '@/i18n/use-translation';
import { unwrapErrorMessage } from '@/lib/ipc';
import { clearProxyAuth, detectSystemProxy, testProxyConnection } from '@/lib/settings-ops';
import type { useSettingsStore } from '@/stores/persistent/settings-store';

import type { ProxyTestResultState } from './proxy-section-fields';

type ProxySettings = ReturnType<typeof useSettingsStore.getState>['proxy'];
type UpdateProxy = ReturnType<typeof useSettingsStore.getState>['updateProxy'];
type ProxyMode = ProxySettings['mode'];

const SYSTEM_PROXY_QUERY_KEY = ['proxy', 'system'] as const;

/** 代理分区副作用依赖（由表单状态 hook 提供，避免把 15 个 setter 作为形参） */
export interface ProxyMutationDeps {
  readonly proxy: ProxySettings;
  readonly mode: ProxyMode;
  readonly updateProxy: UpdateProxy;
  readonly setMode: (mode: ProxyMode) => void;
  readonly setProtocol: (protocol: ProxyProtocol) => void;
  readonly setHost: (host: string) => void;
  readonly setPortText: (port: string) => void;
  readonly setAuthEnabled: (enabled: boolean) => void;
  readonly setUsername: (username: string) => void;
  readonly setPassword: (password: string) => void;
  readonly setTouched: (touched: boolean) => void;
  readonly setTestResult: (result: ProxyTestResultState | null) => void;
  readonly testTarget: string;
  readonly buildDraftConfig: () => NonNullable<ProxyTestReq['config']>;
  readonly persistLatest: () => void;
}

/** 代理分区的查询/变更副作用：清除凭据、系统代理检测/导入、连通性测试 */
export function useProxySectionMutations(deps: ProxyMutationDeps) {
  const { t } = useTranslation();
  const { getErrorMessage } = useErrorMessage();

  const clearAuthMutation = useMutation({
    mutationFn: clearProxyAuth,
    onSuccess: () => {
      deps.setAuthEnabled(false);
      deps.setUsername('');
      deps.setPassword('');
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error, getErrorMessage));
    },
  });

  const systemProxyQuery = useQuery({
    queryKey: SYSTEM_PROXY_QUERY_KEY,
    queryFn: detectSystemProxy,
    enabled: deps.mode === 'system',
    staleTime: 30_000,
  });

  const importMutation = useMutation({
    mutationFn: detectSystemProxy,
    onSuccess: (result) => {
      if (
        !result.detected ||
        result.protocol === undefined ||
        result.host === undefined ||
        result.port === undefined
      ) {
        toast.info(t('settings.proxySystemNotDetected'));
        return;
      }
      deps.setMode('fixed');
      deps.setProtocol(result.protocol);
      deps.setHost(result.host);
      deps.setPortText(String(result.port));
      deps.setAuthEnabled(false);
      deps.setUsername('');
      deps.setPassword('');
      deps.setTouched(true);
      deps.setTestResult(null);
      deps.updateProxy({
        mode: 'fixed',
        protocol: result.protocol,
        host: result.host,
        port: result.port,
        bypass: [],
      });
      toast.success(t('settings.proxyImportSuccess'));
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error, getErrorMessage));
    },
  });

  const testMutation = useMutation({
    mutationFn: async (targetUrl?: string): Promise<ProxyTestResultState> => {
      const response = await testProxyConnection({
        config: deps.buildDraftConfig(),
        ...(targetUrl !== undefined && targetUrl !== '' ? { targetUrl } : {}),
      });
      return {
        ok: response.ok,
        kind: response.kind,
        ...(response.latencyMs !== undefined ? { latencyMs: response.latencyMs } : {}),
      };
    },
    onSuccess: (result) => {
      deps.setTestResult(result);
    },
    onError: (error) => {
      deps.setTestResult({ ok: false, kind: 'target-unreachable' });
      toast.error(unwrapErrorMessage(error, getErrorMessage));
    },
  });

  const runTest = (): void => {
    const target = deps.testTarget.trim();
    if (target !== '' && !isHttpUrl(target)) {
      toast.error(t('settings.proxyTestTargetInvalid'));
      return;
    }
    deps.persistLatest();
    testMutation.mutate(target === '' ? undefined : target);
  };

  return { clearAuthMutation, systemProxyQuery, importMutation, testMutation, runTest };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
