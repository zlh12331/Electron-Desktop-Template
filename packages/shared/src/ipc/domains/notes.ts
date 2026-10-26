// domains/notes.ts：Local Notes 参考切片的 IPC 定义（channel 元数据见 ../meta.ts）
// 边界：只声明方法与 schema 绑定；SQL/文件/授权/失效在 main 的 repository/handler。
import type {
  NoteCreateRes,
  NoteDeleteRes,
  NoteExportFileRes,
  NoteGetRes,
  NoteImportFileRes,
  NoteListRes,
  NoteUpdateRes,
} from '../../schemas/notes';
import {
  NoteCreateReqSchema,
  NoteCreateResSchema,
  NoteDeleteReqSchema,
  NoteDeleteResSchema,
  NoteExportFileReqSchema,
  NoteExportFileResSchema,
  NoteGetReqSchema,
  NoteGetResSchema,
  NoteImportFileReqSchema,
  NoteImportFileResSchema,
  NoteListReqSchema,
  NoteListResSchema,
  NoteUpdateReqSchema,
  NoteUpdateResSchema,
} from '../../schemas/notes';
import { IPC_META } from '../meta';
import { withSchema } from '../with-schema';

export const notesDomain = {
  list: withSchema(IPC_META.notes.list, NoteListReqSchema, {} as NoteListRes, NoteListResSchema),
  get: withSchema(IPC_META.notes.get, NoteGetReqSchema, {} as NoteGetRes, NoteGetResSchema),
  create: withSchema(
    IPC_META.notes.create,
    NoteCreateReqSchema,
    {} as NoteCreateRes,
    NoteCreateResSchema,
  ),
  update: withSchema(
    IPC_META.notes.update,
    NoteUpdateReqSchema,
    {} as NoteUpdateRes,
    NoteUpdateResSchema,
  ),
  delete: withSchema(
    IPC_META.notes.delete,
    NoteDeleteReqSchema,
    {} as NoteDeleteRes,
    NoteDeleteResSchema,
  ),
  importFile: withSchema(
    IPC_META.notes.importFile,
    NoteImportFileReqSchema,
    {} as NoteImportFileRes,
    NoteImportFileResSchema,
  ),
  exportFile: withSchema(
    IPC_META.notes.exportFile,
    NoteExportFileReqSchema,
    {} as NoteExportFileRes,
    NoteExportFileResSchema,
  ),
} as const;
