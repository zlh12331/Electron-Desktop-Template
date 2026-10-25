import type { SecretsAvailabilityRes, SecretsGetMaskedRes } from '@code-agent/shared/renderer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useErrorMessage } from '@/i18n/use-translation';
import { hasIpcBridge, unwrap, unwrapErrorMessage } from '@/lib/ipc';

/** 凭据键名列表查询 key */
const SECRET_KEYS_QUERY_KEY = ['secret-keys'] as const;

/** 加密能力查询 key */
const SECRETS_AVAILABILITY_QUERY_KEY = ['secrets-availability'] as const;

/** 单条凭据掩码查询 key 前缀（列表失效时一并失效） */
const SECRET_MASKED_QUERY_KEY = ['secret-masked'] as const;

/** 单条凭据掩码的完整 query key（避免内联数组字面量，见 check:ui-consistency 的 inline-query-key） */
function secretMaskedKey(key: string): readonly [string, string] {
  return [SECRET_MASKED_QUERY_KEY[0], key];
}

/** 无桥（浏览器模式）时的能力声明：如实返回不可用，UI 据此隐藏写入口 */
const NO_BRIDGE_AVAILABILITY: SecretsAvailabilityRes = {
  available: false,
  platform: 'browser',
  backend: null,
  reason: 'unavailable',
};

/** safeStorage 加密能力（决定 UI 是否允许写入） */
export function useSecretsAvailability() {
  return useQuery({
    queryKey: SECRETS_AVAILABILITY_QUERY_KEY,
    queryFn: async (): Promise<SecretsAvailabilityRes> => {
      if (!hasIpcBridge()) {
        return NO_BRIDGE_AVAILABILITY;
      }
      return unwrap(await window.api.secrets.isAvailable());
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** 已存储凭据的键名列表（不包含值） */
export function useSecretKeys() {
  return useQuery({
    queryKey: SECRET_KEYS_QUERY_KEY,
    queryFn: async (): Promise<readonly string[]> => {
      if (!hasIpcBridge()) {
        return [];
      }
      return unwrap(await window.api.secrets.list()).keys;
    },
  });
}

/** 单条凭据的掩码值（键不存在 → null） */
export function useSecretMasked(key: string | null) {
  return useQuery({
    queryKey: secretMaskedKey(key ?? ''),
    queryFn: async (): Promise<SecretsGetMaskedRes> => {
      if (key === null || !hasIpcBridge()) {
        return { masked: null };
      }
      return unwrap(await window.api.secrets.getMasked({ key }));
    },
    enabled: key !== null,
  });
}

/** 写入/覆盖凭据（成功后失效键名列表与对应掩码） */
export function useSetSecret() {
  const queryClient = useQueryClient();
  const { getErrorMessage } = useErrorMessage();

  return useMutation({
    mutationFn: async (input: { key: string; value: string }) => {
      return unwrap(await window.api.secrets.set(input));
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: SECRET_KEYS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: secretMaskedKey(input.key),
      });
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error as Error, getErrorMessage));
    },
  });
}

/** 删除凭据（成功后失效键名列表与对应掩码） */
export function useDeleteSecret() {
  const queryClient = useQueryClient();
  const { getErrorMessage } = useErrorMessage();

  return useMutation({
    mutationFn: async (key: string) => {
      return unwrap(await window.api.secrets.delete({ key }));
    },
    onSuccess: (_data, key) => {
      void queryClient.invalidateQueries({ queryKey: SECRET_KEYS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: secretMaskedKey(key),
      });
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error as Error, getErrorMessage));
    },
  });
}
