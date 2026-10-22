// domains/window.ts：window 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../definitions.ts 聚合行 + ../domains/index.ts 登记

import type { ApplyZoomRes } from '../../schemas/window';
import { ApplyZoomReqSchema, ApplyZoomResSchema } from '../../schemas/window';
import { IPC_META } from '../meta';
import { withSchema } from '../with-schema';

export const windowDomain = {
  applyZoom: withSchema(
    IPC_META.window.applyZoom,
    ApplyZoomReqSchema,
    {} as ApplyZoomRes,
    ApplyZoomResSchema,
  ),
} as const;
