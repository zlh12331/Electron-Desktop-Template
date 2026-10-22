// domains/invalidation.ts：invalidation 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../definitions.ts 聚合行 + ../domains/index.ts 登记

import type { InvalidationPayload } from '../../schemas/invalidation';
import { InvalidationPayloadSchema } from '../../schemas/invalidation';
import { IPC_META } from '../meta';
import { withPayload } from '../with-schema';

export const invalidationDomain = {
  // 失效域事件：主进程写路径声明受影响域后广播（payload 契约见 schemas/invalidation.ts）
  subscribeDomains: withPayload(
    IPC_META.invalidation.subscribeDomains,
    {} as InvalidationPayload,
    InvalidationPayloadSchema,
  ),
} as const;
