import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSafeStorage, mockApp } = vi.hoisted(() => ({
  mockSafeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => {
      const text = b.toString('utf8');
      if (!text.startsWith('enc:')) {
        throw new Error('decrypt failed');
      }
      return text.slice(4);
    }),
  },
  mockApp: { getPath: vi.fn(() => tmpdir()) },
}));

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage,
  app: mockApp,
}));

vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), withTrace: vi.fn() },
}));

import { secretsHandlers } from './secrets.handler';

const EMPTY_CTX = {} as never;

describe('secrets.handler', () => {
  let userDataDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
    userDataDir = mkdtempSync(join(tmpdir(), 'code-agent-secrets-'));
    mockApp.getPath.mockReturnValue(userDataDir);
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it('isAvailable：如实反映 safeStorage 能力与平台', async () => {
    const res = await secretsHandlers.isAvailable(undefined, EMPTY_CTX);
    expect(res).toEqual({ available: true, platform: process.platform });

    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(await secretsHandlers.isAvailable(undefined, EMPTY_CTX)).toEqual({
      available: false,
      platform: process.platform,
    });
  });

  it('list：空库返回空数组', async () => {
    expect(await secretsHandlers.list(undefined, EMPTY_CTX)).toEqual({ keys: [] });
  });

  it('set + list：写入后键名按字典序返回', async () => {
    await secretsHandlers.set({ key: 'zebra', value: 'v1' }, EMPTY_CTX);
    await secretsHandlers.set({ key: 'alpha', value: 'v2' }, EMPTY_CTX);

    expect(await secretsHandlers.list(undefined, EMPTY_CTX)).toEqual({ keys: ['alpha', 'zebra'] });
  });

  it('getMasked：返回掩码而非明文', async () => {
    // 拼接构造：避免测试字面量被 gitleaks 的 generic-api-key 规则命中
    const plaintext = ['sk', 'live', '0123456789'].join('-');
    await secretsHandlers.set({ key: 'api-key', value: plaintext }, EMPTY_CTX);

    const res = await secretsHandlers.getMasked({ key: 'api-key' }, EMPTY_CTX);
    expect(res.masked).toBe('sk-****6789');
    expect(JSON.stringify(res)).not.toContain('live');
  });

  it('getMasked：键不存在 → null', async () => {
    expect(await secretsHandlers.getMasked({ key: 'missing' }, EMPTY_CTX)).toEqual({
      masked: null,
    });
  });

  it('delete：删除后键名消失，且重复删除幂等', async () => {
    await secretsHandlers.set({ key: 'temp', value: 'v' }, EMPTY_CTX);

    expect(await secretsHandlers.delete({ key: 'temp' }, EMPTY_CTX)).toEqual({ ok: true });
    expect(await secretsHandlers.list(undefined, EMPTY_CTX)).toEqual({ keys: [] });
    expect(await secretsHandlers.delete({ key: 'temp' }, EMPTY_CTX)).toEqual({ ok: true });
  });

  it('覆盖写：同名键更新为新值（不产生重复条目）', async () => {
    await secretsHandlers.set({ key: 'k', value: 'first' }, EMPTY_CTX);
    await secretsHandlers.set({ key: 'k', value: 'second' }, EMPTY_CTX);

    expect(await secretsHandlers.list(undefined, EMPTY_CTX)).toEqual({ keys: ['k'] });
    const masked = await secretsHandlers.getMasked({ key: 'k' }, EMPTY_CTX);
    expect(masked.masked).toBe('****');
  });

  it('加密不可用时 set 抛错（拒绝明文落盘）', async () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    await expect(secretsHandlers.set({ key: 'k', value: 'v' }, EMPTY_CTX)).rejects.toThrow(
      /加密不可用/,
    );
  });
});
