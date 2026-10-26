// tables/notes.ts：Local Notes 参考切片的表定义（可随示例整体移除）
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 笔记表 */
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 笔记查询行类型 */
export type NoteRow = typeof notes.$inferSelect;

/** 笔记插入类型 */
export type NoteInsert = typeof notes.$inferInsert;
