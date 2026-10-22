// definitions.ts：IPC 定义表聚合层——把 domains/ 下的域定义合成单一真源
// 布局：meta.ts（零依赖 channel 元数据）→ domains/<domain>.ts（schema + 类型标记）
//       → 本文件（聚合） → channels.ts / payloads.ts / api.ts（派生）
// 边界：本文件不写任何具体方法，只做聚合与编译期一致性校验。
// 新增一个 IPC 方法 = meta.ts 一行 + 对应 domains/<domain>.ts 一行 + handler 一个方法；
// 新增一个域 = domains/<domain>.ts 新文件 + domains/index.ts 登记。
import { IPC_DOMAINS } from './domains';
import type { IPC_META, IpcMeta } from './meta';

/** IPC 定义表（完整：channel + schema + 类型） */
export const IPC_DEFINITIONS = IPC_DOMAINS;

/** IPC 定义表类型 */
export type IpcDefinitions = typeof IPC_DEFINITIONS;

export { withPayload, withSchema } from './with-schema';
/** 元数据表类型透传（供 preload 生成器类型约束） */
export type { IpcMeta };

// ───── 编译期双向同步检查：meta 与 definitions 的方法集合必须一致 ─────
// "definitions ⊆ meta" 由构造方式天然保证（definitions 逐条引用 meta 条目）；
// 反向的 "meta ⊆ definitions" 没有结构保证——meta 多写一个方法时 preload 会照常暴露它、
// register 却不注册，直到运行时调用才失败。这里的类型相等检查把两个方向都钉在编译期。
// 注意：const 声明只是类型推断占位，不产生运行时代码。
type _MissingMethods<A, B> = {
  [K in keyof A]: K extends keyof B
    ? Exclude<keyof A[K], keyof B[K]> extends never
      ? true
      : { domain: K; missingInB: Exclude<keyof A[K], keyof B[K]> }
    : { domain: K; domainMissingInB: true };
}[keyof A];

// meta ⊆ definitions（meta 多写方法 → 编译失败）
const _metaCoversDefs: _MissingMethods<typeof IPC_META, typeof IPC_DEFINITIONS> = true;
// definitions ⊆ meta（definitions 多写方法 → 编译失败）
const _defsCoversMeta: _MissingMethods<typeof IPC_DEFINITIONS, typeof IPC_META> = true;
// 占位使用，避免 noUnusedLocals（类型检查本身即价值所在）
void _metaCoversDefs;
void _defsCoversMeta;
