// invalidation.ts：失效域契约——invalidation:event:domains 事件 payload + 域词表
// 域元素形如 'settings' / 'entity:<id>'：渲染层 split(':') 得 queryKey 前缀并逐域失效
//（实现见 src/renderer/lib/invalidation/invalidation.ts）。失效「知识」收敛在写入端声明，
// 收发实现分处 src/main/infra/invalidation/ 与 src/renderer/lib/invalidation/，本文件只定义契约。

import { z } from 'zod';

// ────────── 事件 payload（主进程 → 渲染层）──────────

/** invalidation:event:domains 事件 payload zod schema（经 IPC 定义表引用，主进程发送侧 dev 校验） */
export const InvalidationPayloadSchema = z.object({
  /** 受影响的域清单（至少一个；渲染层逐域前缀失效） */
  domains: z.array(z.string().min(1)).min(1),
  /** 引发失效的实体 id（可选上下文；失效指令以 domains 为准） */
  sessionId: z.string().min(1).optional(),
});

/** invalidation:event:domains 事件 payload：受影响域 + 可选实体上下文 */
export interface InvalidationPayload {
  /** 受影响的域清单（元素形如 'settings' / 'entity:<id>'） */
  readonly domains: readonly string[];
  /** 引发失效的实体 id（可选；供日志排障与未来按实体过滤） */
  readonly sessionId?: string;
}

// ────────── 失效域词表 ──────────

/**
 * 失效域词表（主进程声明点统一取词，禁散写字面量）
 *
 * 值即 payload 元素：渲染层 split(':') 后前半段为 queryKey 根，
 * 与渲染层 QUERY_KEY_ROOTS 键对齐（漂移由 lib/invalidation 单测锚定）。
 * 模板版只保留通用域；新增业务域时在此追加并同步渲染层 key 根。
 */
export const INVALIDATION_DOMAINS = {
  /** 设置域：主进程写入设置后广播，渲染层失效设置快照查询 */
  settings: 'settings',
  /** 备份域：备份创建/恢复后刷新备份列表 */
  backups: 'backups',
  /** 更新域：更新状态变化后刷新缓存信息 */
  update: 'update',
} as const;
