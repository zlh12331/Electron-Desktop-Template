// tables/core.ts：核心表——任何桌面应用都需要的通用持久化（模板保留此文件）
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 用户设置键值表（JSON 文本值；渲染层 settings 写穿透目标） */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** app_settings 表的查询行类型 */
export type AppSettingRow = typeof appSettings.$inferSelect;

/** app_settings 表的插入类型 */
export type AppSettingInsert = typeof appSettings.$inferInsert;
