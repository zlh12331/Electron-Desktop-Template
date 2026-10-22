// domains/dialog.ts：dialog 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）
// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../definitions.ts 聚合行 + ../domains/index.ts 登记

import type { DialogPickDirectoryRes, DialogPickFilesRes } from '../../schemas/dialog';
import {
  DialogPickDirectoryReqSchema,
  DialogPickDirectoryResSchema,
  DialogPickFilesReqSchema,
  DialogPickFilesResSchema,
} from '../../schemas/dialog';
import { IPC_META } from '../meta';
import { withSchema } from '../with-schema';

export const dialogDomain = {
  pickDirectory: withSchema(
    IPC_META.dialog.pickDirectory,
    DialogPickDirectoryReqSchema,
    {} as DialogPickDirectoryRes,
    DialogPickDirectoryResSchema,
  ),
  pickFiles: withSchema(
    IPC_META.dialog.pickFiles,
    DialogPickFilesReqSchema,
    {} as DialogPickFilesRes,
    DialogPickFilesResSchema,
  ),
} as const;
