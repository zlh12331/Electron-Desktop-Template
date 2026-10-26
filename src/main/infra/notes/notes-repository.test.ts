import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDB } from '../storage/db';
import { schema } from '../storage/schema';
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  NOTES_LIST_LIMIT,
  updateNote,
} from './notes-repository';

let sqlite: Database.Database;
let db: DrizzleDB;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(
    'CREATE TABLE notes (id text PRIMARY KEY NOT NULL, title text NOT NULL, body text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)',
  );
  db = drizzle(sqlite, { schema });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  sqlite.close();
});

describe('notes repository', () => {
  it('创建后按 updatedAt 倒序返回摘要，并截断预览', () => {
    const older = createNote({ title: 'Older', body: 'old body' }, db);
    vi.setSystemTime(new Date('2026-10-26T00:00:01Z'));
    const newer = createNote({ title: 'Newer', body: `${'x'.repeat(200)}\n\n tail` }, db);

    const list = listNotes(undefined, db);

    expect(list.map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(list[0]?.preview).toHaveLength(160);
    expect(list[0]?.preview).not.toContain('\n');
  });

  it('搜索同时匹配标题与正文', () => {
    createNote({ title: 'Alpha', body: 'first' }, db);
    createNote({ title: 'Beta', body: 'contains alpha token' }, db);

    expect(listNotes('Alpha', db)).toHaveLength(2);
    expect(listNotes('Beta', db)).toHaveLength(1);
    expect(listNotes('missing', db)).toHaveLength(0);
  });

  it('读取不存在返回 null；更新只改提供的字段', () => {
    const note = createNote({ title: 'Title', body: 'Body' }, db);
    vi.setSystemTime(new Date('2026-10-26T00:00:05Z'));

    const updated = updateNote(note.id, { body: 'Updated body' }, db);

    expect(updated).toMatchObject({
      id: note.id,
      title: 'Title',
      body: 'Updated body',
      createdAt: note.createdAt,
      updatedAt: Date.parse('2026-10-26T00:00:05Z'),
    });
    expect(getNote('missing', db)).toBeNull();
    expect(updateNote('missing', { title: 'x' }, db)).toBeNull();
  });

  it('删除返回是否命中，重复删除为 false', () => {
    const note = createNote({ title: 'Delete me', body: '' }, db);

    expect(deleteNote(note.id, db)).toBe(true);
    expect(deleteNote(note.id, db)).toBe(false);
    expect(getNote(note.id, db)).toBeNull();
  });

  it('列表上限防止一次拉全库', () => {
    expect(NOTES_LIST_LIMIT).toBeGreaterThan(0);
  });
});
