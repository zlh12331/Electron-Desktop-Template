import { describe, expect, it, vi } from 'vitest';
import { ensureBaselineConsistency } from './update-service-helpers';

describe('ensureBaselineConsistency', () => {
  it('无缓存目录：返回 skipped，不调用修剪', async () => {
    const prune = vi.fn();
    const result = await ensureBaselineConsistency(async () => null, prune);
    expect(result).toBe('skipped');
    expect(prune).not.toHaveBeenCalled();
  });

  it.each(['pruned', 'consistent', 'absent'] as const)('透传修剪结果：%s', async (expected) => {
    const prune = vi.fn(async () => expected);
    const result = await ensureBaselineConsistency(async () => 'C:/cache', prune);
    expect(result).toBe(expected);
    expect(prune).toHaveBeenCalledWith('C:/cache');
  });

  it('解析缓存目录失败：返回 error，不抛错', async () => {
    const result = await ensureBaselineConsistency(async () => {
      throw new Error('resourcesPath unavailable');
    }, vi.fn());
    expect(result).toBe('error');
  });

  it('修剪失败：返回 error，不阻断更新下载', async () => {
    const result = await ensureBaselineConsistency(
      async () => 'C:/cache',
      async () => {
        throw new Error('EPERM');
      },
    );
    expect(result).toBe('error');
  });
});
