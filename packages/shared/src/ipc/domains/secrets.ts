// domains/secrets.ts：secrets 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../domains/index.ts 登记

import type {
  SecretsAvailabilityRes,
  SecretsDeleteRes,
  SecretsGetMaskedRes,
  SecretsListRes,
  SecretsSetRes,
} from '../../schemas/secrets';
import {
  SecretsAvailabilityResSchema,
  SecretsDeleteReqSchema,
  SecretsDeleteResSchema,
  SecretsGetMaskedReqSchema,
  SecretsGetMaskedResSchema,
  SecretsListResSchema,
  SecretsSetReqSchema,
  SecretsSetResSchema,
} from '../../schemas/secrets';
import { IPC_META } from '../meta';
import { withSchema } from '../with-schema';

export const secretsDomain = {
  isAvailable: withSchema(
    IPC_META.secrets.isAvailable,
    null,
    {} as SecretsAvailabilityRes,
    SecretsAvailabilityResSchema,
  ),
  list: withSchema(IPC_META.secrets.list, null, {} as SecretsListRes, SecretsListResSchema),
  set: withSchema(
    IPC_META.secrets.set,
    SecretsSetReqSchema,
    {} as SecretsSetRes,
    SecretsSetResSchema,
  ),
  delete: withSchema(
    IPC_META.secrets.delete,
    SecretsDeleteReqSchema,
    {} as SecretsDeleteRes,
    SecretsDeleteResSchema,
  ),
  getMasked: withSchema(
    IPC_META.secrets.getMasked,
    SecretsGetMaskedReqSchema,
    {} as SecretsGetMaskedRes,
    SecretsGetMaskedResSchema,
  ),
} as const;
