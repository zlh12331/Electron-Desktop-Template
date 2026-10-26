// notes-repository.ts：Local Notes 参考切片的 SQLite 仓储——参数化查询 + 事件时间戳
// db 参数默认取应用单例，测试可注入内存 Drizzle 实例；不做 IPC/文件/广播（handler 负责）。
import { randomUUID } from 'node:crypto';
import type { Note, NoteSummary } from '@code-agent/shared/main';
import { desc, eq, like, or } from 'drizzle-orm';
import { type DrizzleDB, getDb } from '../storage/db';
import { notes } from '../storage/schema';
import type { NoteRow } from '../storage/tables/notes';

/** 列表最多返回的笔记数（防止一次 IPC 拉全库） */
export const NOTES_LIST_LIMIT = 200;

/** 预览截断长度 */
const PREVIEW_CHARS = 160;

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSummary(row: NoteRow): NoteSummary {
  const preview = row.body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
  return { id: row.id, title: row.title, preview, updatedAt: row.updatedAt };
}

/**
 * 列出笔记（updatedAt 倒序；query 同时匹配标题与正文）
 *
 * @param query 搜索词；空/省略返回全部
 * @param db 注入的 Drizzle 实例（测试用；生产走应用单例）
 * @returns 列表摘要（不含完整正文）
 */
export function listNotes(query?: string, db: DrizzleDB = getDb()): NoteSummary[] {
  const keyword = query?.trim() ?? '';
  const rows =
    keyword.length === 0
      ? db.select().from(notes).orderBy(desc(notes.updatedAt)).limit(NOTES_LIST_LIMIT).all()
      : db
          .select()
          .from(notes)
          .where(or(like(notes.title, `%${keyword}%`), like(notes.body, `%${keyword}%`)))
          .orderBy(desc(notes.updatedAt))
          .limit(NOTES_LIST_LIMIT)
          .all();
  return rows.map(toSummary);
}

/**
 * 按 id 读取完整笔记
 *
 * @param id 笔记 id
 * @param db 注入的 Drizzle 实例
 * @returns 笔记；不存在返回 null
 */
export function getNote(id: string, db: DrizzleDB = getDb()): Note | null {
  const row = db.select().from(notes).where(eq(notes.id, id)).all()[0];
  return row === undefined ? null : toNote(row);
}

/**
 * 创建笔记
 *
 * @param input 标题与正文（已由 IPC schema 校验）
 * @param db 注入的 Drizzle 实例
 * @returns 新笔记
 */
export function createNote(
  input: { readonly title: string; readonly body: string },
  db: DrizzleDB = getDb(),
): Note {
  const now = Date.now();
  const note: Note = {
    id: randomUUID(),
    title: input.title,
    body: input.body,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(notes).values(note).run();
  return note;
}

/**
 * 更新笔记（只更新提供的字段）
 *
 * @param id 笔记 id
 * @param patch 标题/正文补丁
 * @param db 注入的 Drizzle 实例
 * @returns 更新后的笔记；不存在返回 null
 */
export function updateNote(
  id: string,
  patch: { readonly title?: string; readonly body?: string },
  db: DrizzleDB = getDb(),
): Note | null {
  const existing = getNote(id, db);
  if (existing === null) {
    return null;
  }
  db.update(notes)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(notes.id, id))
    .run();
  return getNote(id, db);
}

/**
 * 删除笔记
 *
 * @param id 笔记 id
 * @param db 注入的 Drizzle 实例
 * @returns 是否删除了记录
 */
export function deleteNote(id: string, db: DrizzleDB = getDb()): boolean {
  return db.delete(notes).where(eq(notes.id, id)).run().changes > 0;
}
