// domains/logs.ts：logs 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../definitions.ts 聚合行 + ../domains/index.ts 登记

import type { ReadLogsRes } from '../../schemas/system';
import { ReadLogsReqSchema, ReadLogsResSchema } from '../../schemas/system';
import { IPC_META } from '../meta';
import { withSchema } from '../with-schema';

export const logsDomain = {
  read: withSchema(IPC_META.logs.read, ReadLogsReqSchema, {} as ReadLogsRes, ReadLogsResSchema),
} as const;
