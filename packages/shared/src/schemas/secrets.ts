// secrets.ts：secrets 域 IPC 契约单一真源（凭据的增删查，**不含取明文**）
// 安全边界：主进程持有 safeStorage 加密的 keychain.dat，渲染层只能看到掩码值。
// 业务代码需要明文时在主进程内直接 import getSecret（不经 IPC）——渲染层一旦被 XSS
// 或第三方依赖投毒即可批量取走全部凭据，故本域刻意不提供 get 方法。
// 落盘实现见 src/main/infra/storage/keychain.ts（原子写 + 并发锁 + 损坏逐条抢救）。

import { z } from 'zod';

/**
 * 凭据键名：字母数字开头，允许 . _ -，长度 1~64
 *
 * 与 app_settings 的 key 白名单同形（同一套心智模型），且排除了空串与纯符号。
 */
export const SecretKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, '凭据键名须为 1~64 位字母数字与 . _ -');

/**
 * 凭据值上限（64KB）
 *
 * 真实凭据（API Key / token / 连接串）远小于此；设上限防误把大文件塞进密钥库。
 */
export const MAX_SECRET_VALUE_LENGTH = 64 * 1024;

/** secrets:isAvailable 响应（加密能力探测） */
export interface SecretsAvailabilityRes {
  /** safeStorage 是否可用（Linux 缺 libsecret 时为 false，此时既不能读也不能写） */
  readonly available: boolean;
  /**
   * 当前平台标识（`process.platform` 原值；浏览器 mock 为 'web'）
   *
   * 用 string 而非 NodeJS.Platform：shared 包同时被渲染层与 preload 引用，
   * 不应依赖 Node 命名空间。
   */
  readonly platform: string;
}

/** secrets:isAvailable 响应 schema */
export const SecretsAvailabilityResSchema = z.object({
  available: z.boolean(),
  platform: z.string(),
});

/** secrets:list 响应（只返回键名，不返回值） */
export interface SecretsListRes {
  /** 已存储的凭据键名（排序稳定，便于 UI 渲染） */
  readonly keys: readonly string[];
}

/** secrets:list 响应 schema */
export const SecretsListResSchema = z.object({
  keys: z.array(z.string()),
});

/** secrets:set 入参 */
export const SecretsSetReqSchema = z.object({
  key: SecretKeySchema,
  value: z.string().min(1).max(MAX_SECRET_VALUE_LENGTH),
});

/** secrets:set 入参类型 */
export type SecretsSetReq = z.infer<typeof SecretsSetReqSchema>;

/** secrets:set 响应 */
export interface SecretsSetRes {
  readonly ok: boolean;
}

/** secrets:set 响应 schema */
export const SecretsSetResSchema = z.object({ ok: z.boolean() });

/** secrets:delete 入参 */
export const SecretsDeleteReqSchema = z.object({ key: SecretKeySchema });

/** secrets:delete 入参类型 */
export type SecretsDeleteReq = z.infer<typeof SecretsDeleteReqSchema>;

/** secrets:delete 响应 */
export interface SecretsDeleteRes {
  readonly ok: boolean;
}

/** secrets:delete 响应 schema */
export const SecretsDeleteResSchema = z.object({ ok: z.boolean() });

/** secrets:getMasked 入参 */
export const SecretsGetMaskedReqSchema = z.object({ key: SecretKeySchema });

/** secrets:getMasked 入参类型 */
export type SecretsGetMaskedReq = z.infer<typeof SecretsGetMaskedReqSchema>;

/** secrets:getMasked 响应 */
export interface SecretsGetMaskedRes {
  /** 掩码文本（如 `sk-****a1b2`）；键不存在或加密不可用时为 null */
  readonly masked: string | null;
}

/** secrets:getMasked 响应 schema */
export const SecretsGetMaskedResSchema = z.object({
  masked: z.string().nullable(),
});
