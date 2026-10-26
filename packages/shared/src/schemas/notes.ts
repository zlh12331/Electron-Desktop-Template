// notes.ts：Local Notes 参考切片的契约单一真源——列表/详情/创建/更新/删除/导入/导出
// 边界：只定义形状与值域；SQL、文件读取、授权路径与失效广播分别在 main 的 repository/handler
// 该文件及对应 IPC/UI 均可由 init:template 的整体示例移除流程删除。

import { z } from 'zod';

/** 标题上限（字符） */
export const NOTE_TITLE_MAX = 200;
/** 正文上限（字符，约 100KB 英文/50K 中文） */
export const NOTE_BODY_MAX = 100_000;
/** 搜索词上限（字符） */
export const NOTE_SEARCH_MAX = 200;

const NoteTitleSchema = z.string().trim().min(1).max(NOTE_TITLE_MAX);
const NoteBodySchema = z.string().max(NOTE_BODY_MAX);

/** 持久化的笔记实体 */
export interface Note {
  /** UUID（主进程生成） */
  readonly id: string;
  /** 标题 */
  readonly title: string;
  /** 正文（Markdown） */
  readonly body: string;
  /** 创建时间（epoch ms） */
  readonly createdAt: number;
  /** 最后更新时间（epoch ms） */
  readonly updatedAt: number;
}

/** 列表项（不返回完整正文，降低列表 IPC 体积） */
export interface NoteSummary {
  /** UUID */
  readonly id: string;
  /** 标题 */
  readonly title: string;
  /** 正文预览（空白折叠后截断） */
  readonly preview: string;
  /** 最后更新时间（epoch ms） */
  readonly updatedAt: number;
}

/** 笔记实体 zod schema（IPC 响应校验用） */
export const NoteSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

/** 列表项 zod schema */
export const NoteSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  preview: z.string(),
  updatedAt: z.number().int(),
});

/** notes:list 入参（query 为空/省略表示全部） */
export const NoteListReqSchema = z.object({
  query: z.string().trim().max(NOTE_SEARCH_MAX).optional(),
});

/** notes:list 入参类型 */
export type NoteListReq = z.infer<typeof NoteListReqSchema>;

/** notes:list 响应 */
export const NoteListResSchema = z.object({
  notes: z.array(NoteSummarySchema),
});

/** notes:list 响应类型 */
export type NoteListRes = z.infer<typeof NoteListResSchema>;

/** notes:get 入参 */
export const NoteGetReqSchema = z.object({
  id: z.string().min(1),
});

/** notes:get 入参类型 */
export type NoteGetReq = z.infer<typeof NoteGetReqSchema>;

/** notes:get 响应 */
export const NoteGetResSchema = z.object({
  note: NoteSchema,
});

/** notes:get 响应类型 */
export type NoteGetRes = z.infer<typeof NoteGetResSchema>;

/** notes:create 入参 */
export const NoteCreateReqSchema = z.object({
  title: NoteTitleSchema,
  body: NoteBodySchema,
});

/** notes:create 入参类型 */
export type NoteCreateReq = z.infer<typeof NoteCreateReqSchema>;

/** notes:create 响应 */
export const NoteCreateResSchema = z.object({
  note: NoteSchema,
});

/** notes:create 响应类型 */
export type NoteCreateRes = z.infer<typeof NoteCreateResSchema>;

/** notes:update 入参（title/body 至少提供一个） */
export const NoteUpdateReqSchema = z
  .object({
    id: z.string().min(1),
    title: NoteTitleSchema.optional(),
    body: NoteBodySchema.optional(),
  })
  .refine((value) => value.title !== undefined || value.body !== undefined, {
    message: '至少提供 title 或 body',
    path: ['title'],
  });

/** notes:update 入参类型 */
export type NoteUpdateReq = z.infer<typeof NoteUpdateReqSchema>;

/** notes:update 响应 */
export const NoteUpdateResSchema = z.object({
  note: NoteSchema,
});

/** notes:update 响应类型 */
export type NoteUpdateRes = z.infer<typeof NoteUpdateResSchema>;

/** notes:delete 入参 */
export const NoteDeleteReqSchema = z.object({
  id: z.string().min(1),
});

/** notes:delete 入参类型 */
export type NoteDeleteReq = z.infer<typeof NoteDeleteReqSchema>;

/** notes:delete 响应 */
export const NoteDeleteResSchema = z.object({
  ok: z.boolean(),
});

/** notes:delete 响应类型 */
export type NoteDeleteRes = z.infer<typeof NoteDeleteResSchema>;

/** notes:importFile 入参（path 必须来自 dialog:pickFiles 的用户授权） */
export const NoteImportFileReqSchema = z.object({
  path: z.string().min(1).max(4096),
});

/** notes:importFile 入参类型 */
export type NoteImportFileReq = z.infer<typeof NoteImportFileReqSchema>;

/** notes:importFile 响应 */
export const NoteImportFileResSchema = z.object({
  note: NoteSchema,
});

/** notes:importFile 响应类型 */
export type NoteImportFileRes = z.infer<typeof NoteImportFileResSchema>;

/** notes:exportFile 入参 */
export const NoteExportFileReqSchema = z.object({
  id: z.string().min(1),
});

/** notes:exportFile 入参类型 */
export type NoteExportFileReq = z.infer<typeof NoteExportFileReqSchema>;

/** notes:exportFile 响应（取消保存时 saved=false） */
export const NoteExportFileResSchema = z.object({
  saved: z.boolean(),
  path: z.string().optional(),
});

/** notes:exportFile 响应类型 */
export type NoteExportFileRes = z.infer<typeof NoteExportFileResSchema>;
