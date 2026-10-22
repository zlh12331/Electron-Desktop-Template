// with-schema.ts：IPC 定义表装配原语——在 meta 元数据上合并 zod schema 与类型标记
// 为什么单独成文件：各域定义文件（domains/*.ts）与聚合层（definitions.ts）都要用，
// 放在 definitions.ts 会形成 domains → definitions → domains 的循环依赖。
// 边界：只做类型层标记合并，不做任何校验（校验在 src/main/utils/wrap.ts）。

/** 在元数据基础上合并 schema 与响应类型标记（request 方法） */
export function withSchema<
  M extends { readonly kind: 'request'; readonly channel: string },
  S extends import('zod').ZodType | null,
  R,
  // biome-ignore lint/style/useNamingConvention: RS 为 TS 泛型惯例（响应 schema 类型参数）
  RS extends import('zod').ZodType | undefined = undefined,
>(
  meta: M,
  schema: S,
  _res: R,
  resSchema?: RS,
): M & { readonly schema: S; readonly res: R; readonly resSchema?: RS } {
  return {
    ...meta,
    schema,
    res: undefined as unknown as R,
    ...(resSchema !== undefined ? { resSchema } : {}),
  } as M & { readonly schema: S; readonly res: R; readonly resSchema?: RS };
}

/** 在元数据基础上合并事件 payload 类型标记（event 方法） */
export function withPayload<
  M extends { readonly kind: 'event'; readonly channel: string },
  P,
  // biome-ignore lint/style/useNamingConvention: PS 为 TS 泛型惯例（payload schema 类型参数）
  PS extends import('zod').ZodType | undefined = undefined,
>(
  meta: M,
  _payload: P,
  payloadSchema?: PS,
): M & { readonly payload: P; readonly payloadSchema?: PS } {
  return {
    ...meta,
    payload: undefined as unknown as P,
    ...(payloadSchema !== undefined ? { payloadSchema } : {}),
  } as M & { readonly payload: P; readonly payloadSchema?: PS };
}
