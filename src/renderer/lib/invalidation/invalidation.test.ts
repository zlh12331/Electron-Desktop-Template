import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

vi.mock('@/lib/query/query-client', () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));

import { applyDomainInvalidation } from './invalidation';

describe('applyDomainInvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('合法域按冒号拆成 queryKey 前缀', () => {
    applyDomainInvalidation(['settings', 'entity:abc']);
    expect(mocks.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['settings'] });
    expect(mocks.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['entity', 'abc'] });
  });

  it('空串、空段与首段为空一律跳过', () => {
    applyDomainInvalidation(['', 'entity:', ':x', 'a::b']);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });
});
