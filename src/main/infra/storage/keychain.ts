// keychain.ts：敏感凭据存储——safeStorage（DPAPI/Keychain/libsecret）加密后落
// keychain.dat JSON（值为字节数组）；损坏按条目抢救 + .corrupt 留档，绝不静默清空。
// 消费方：secrets IPC 域（增删查掩码）；业务代码需要明文时在主进程内直接调 getSecret。
import { promises as fs } from 'node:fs';
import { AppError, ErrorCode } from '@code-agent/shared/main';
import { safeStorage } from 'electron';
import { reportError } from '../../utils/error-report';
import { restrictFilePermissions } from '../../utils/file-permissions';
import { logger } from '../../utils/logger';
import { getKeychainPath } from './app-data';

// 全局写锁串行化 read-modify-write（readStore 与 writeStore 之间不能被并发插入，否则丢更新）
let lock: Promise<void> = Promise.resolve();

let warnedEncryptionUnavailable = false;

// 双下划线前缀为内部保留键（如代理凭据），不通过 secrets IPC 域暴露/改写
const RESERVED_SECRET_PREFIX = '__';

/** safeStorage 是否可用（Linux 无 libsecret 时为 false，届时密钥全部不可读） */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** 是否为内部保留凭据键（secrets 域必须拒绝读写） */
export function isReservedSecretKey(key: string): boolean {
  return key.startsWith(RESERVED_SECRET_PREFIX);
}

// 简易互斥队列：新请求排在既有锁链尾部，返回的 release 释放自己的槽位
function acquireLock(): Promise<() => void> {
  const waiting = lock;
  let release: () => void = () => {};
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  lock = waiting.then(() => slot);
  return waiting.then(() => release);
}

type KeychainStore = Record<string, number[]>;

function isEncryptedArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)
  );
}

function isKeychainStore(value: unknown): value is KeychainStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isEncryptedArray);
}

const ENTRY_FRAGMENT_PATTERN = /"((?:[^"\\]|\\.)+)"\s*:\s*(\[[^\][]*\])/g;

// 结构级抢救：整体 JSON 解析失败后按「"键": [字节数组]」碎片正则逐条提取，
// 能解密通过的收编——文件部分损坏时尽量少丢密钥
function salvageEntries(raw: string): { store: KeychainStore; candidates: number } {
  const store: KeychainStore = {};
  let candidates = 0;
  for (const match of raw.matchAll(ENTRY_FRAGMENT_PATTERN)) {
    const [, rawKey, rawArray] = match;
    if (rawKey === undefined || rawArray === undefined) {
      continue;
    }
    candidates += 1;
    try {
      const parsed = JSON.parse(rawArray) as unknown;
      if (!isEncryptedArray(parsed)) {
        continue;
      }
      safeStorage.decryptString(Buffer.from(parsed));
      store[JSON.parse(`"${rawKey}"`) as string] = parsed;
    } catch {}
  }
  return { store, candidates };
}

// 读取失败绝不降级为空库继续——后续写会把既有密钥整体覆盖掉，宁可炸掉本次操作
function throwKeychainReadError(error: unknown, filePath: string): never {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(
    { error: message, filePath },
    'keychain.dat 读取失败（拒绝以降级空库继续，避免覆盖既有密钥）',
  );
  throw new AppError(
    ErrorCode.INTERNAL_ERROR,
    `密钥库读取失败，已中止本次操作以保护既有密钥：${message}`,
  );
}

async function readStore(): Promise<KeychainStore> {
  const filePath = getKeychainPath();
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      return {};
    }
    throwKeychainReadError(error, filePath);
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (isKeychainStore(parsed)) {
      return parsed;
    }
    throw new Error('keychain.dat 结构不符合契约');
  } catch {
    const { store: salvaged, candidates } = salvageEntries(content);
    const salvagedCount = Object.keys(salvaged).length;
    const lostCount = Math.max(candidates - salvagedCount, 0);
    reportError(new Error(`keychain.dat 已损坏（salvaged=${salvagedCount}, lost=${lostCount}）`), {
      message: 'keychain.dat 已损坏——按条目抢救（salvaged/lost），原件保留为 .corrupt',
      fields: {
        filePath,
        corrupted: true,
        recoverable: salvagedCount > 0,
        salvaged: salvagedCount,
        lost: lostCount,
      },
      tags: { scope: 'keychain', stage: 'salvage' },
    });
    try {
      await fs.rename(filePath, `${filePath}.corrupt`);
    } catch {}
    if (salvagedCount > 0) {
      await writeStore(salvaged);
    }
    return salvaged;
  }
}

// 写入三防：0600 创建 + fsync 落盘 + tmp/rename 原子替换；失败清 tmp 不留半截文件
async function writeStore(store: KeychainStore): Promise<void> {
  const filePath = getKeychainPath();
  const content = JSON.stringify(store, null, 2);
  const tmpPath = `${filePath}.tmp`;
  try {
    const handle = await fs.open(tmpPath, 'w', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
  restrictFilePermissions(filePath);
}

/** 写入密钥（加密不可用直接抛——明文落盘不可接受） */
export async function setSecret(key: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 加密不可用，无法存储敏感数据');
  }

  const release = await acquireLock();
  try {
    const encrypted = safeStorage.encryptString(value);
    const store = await readStore();
    store[key] = Array.from(encrypted);
    await writeStore(store);
  } finally {
    release();
  }
}

/**
 * 读取密钥；加密不可用时返回 null 并只告警一次（不炸调用方——上游按「未配置」处理）
 *
 * ⚠️ 仅供**主进程内部**业务代码调用，不得经 IPC 暴露给渲染层。
 */
export async function getSecret(key: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    if (!warnedEncryptionUnavailable) {
      warnedEncryptionUnavailable = true;
      logger.warn({ key }, 'safeStorage 加密不可用：已保存的凭据均不可读取（getSecret 返回 null）');
    }
    return null;
  }

  const release = await acquireLock();
  try {
    const store = await readStore();
    const encryptedArray = store[key];
    if (encryptedArray === undefined) {
      return null;
    }

    const encrypted = Buffer.from(encryptedArray);
    return safeStorage.decryptString(encrypted);
  } finally {
    release();
  }
}

/**
 * 把明文凭据转为可展示的掩码（`sk-abc123def456` → `sk-****f456`）
 *
 * 保留前 3 位与后 4 位：足够让用户确认「这是我填的那把」，又不泄露可用部分。
 * 长度不足以掩码时（≤8）全遮蔽为 `****`，避免短凭据被反推。
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export async function deleteSecret(key: string): Promise<void> {
  const release = await acquireLock();
  try {
    const store = await readStore();
    if (store[key] !== undefined) {
      delete store[key];
      await writeStore(store);
    }
  } finally {
    release();
  }
}

export async function listSecrets(): Promise<string[]> {
  const release = await acquireLock();
  try {
    const store = await readStore();
    return Object.keys(store);
  } finally {
    release();
  }
}
