// domains/update.ts：update 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../definitions.ts 聚合行 + ../domains/index.ts 登记

import { OkResSchema } from '../../schemas/app';
import type {
  UpdateCacheInfo,
  UpdateCheckRes,
  UpdateGetStatusRes,
  UpdateStatusPayload,
} from '../../schemas/update';
import {
  UpdateCacheInfoSchema,
  UpdateCheckReqSchema,
  UpdateCheckResSchema,
  UpdateGetStatusResSchema,
  UpdateStatusPayloadSchema,
} from '../../schemas/update';
import { IPC_META } from '../meta';
import { withPayload, withSchema } from '../with-schema';

export const updateDomain = {
  check: withSchema(
    IPC_META.update.check,
    UpdateCheckReqSchema,
    {} as UpdateCheckRes,
    UpdateCheckResSchema,
  ),
  install: withSchema(IPC_META.update.install, null, {} as { ok: boolean }, OkResSchema),
  cancel: withSchema(IPC_META.update.cancel, null, {} as { ok: boolean }, OkResSchema),
  getStatus: withSchema(
    IPC_META.update.getStatus,
    null,
    {} as UpdateGetStatusRes,
    UpdateGetStatusResSchema,
  ),
  getCacheInfo: withSchema(
    IPC_META.update.getCacheInfo,
    null,
    {} as UpdateCacheInfo,
    UpdateCacheInfoSchema,
  ),
  clearCache: withSchema(
    IPC_META.update.clearCache,
    null,
    {} as UpdateCacheInfo,
    UpdateCacheInfoSchema,
  ),
  subscribeStatus: withPayload(
    IPC_META.update.subscribeStatus,
    {} as UpdateStatusPayload,
    UpdateStatusPayloadSchema,
  ),
} as const;
