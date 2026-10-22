import { queryClient } from '@/lib/query/query-client';

/**
 * 失效域 → queryKey 前缀
 *
 * 'settings' → ['settings']；'entity:abc' → ['entity', 'abc']。
 * 非法形态（空串 / 空段如 'entity:'）返回 null，调用方跳过——
 * 前向兼容：旧渲染层收到未来新增的域形状时静默降级而不是抛错。
 */
function domainToQueryKey(domain: string): readonly string[] | null {
  if (domain.length === 0) {
    return null;
  }
  const segments = domain.split(':');
  const root = segments[0];
  if (root === undefined || root.length === 0) {
    return null;
  }
  if (segments.slice(1).some((segment) => segment.length === 0)) {
    return null;
  }
  return segments;
}

/**
 * 逐域前缀失效（未知/非法域跳过）
 */
export function applyDomainInvalidation(domains: readonly string[]): void {
  for (const domain of domains) {
    const key = domainToQueryKey(domain);
    if (key !== null) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }
}
