// notes-schemas.test.ts：Local Notes 契约边界——标题/正文/搜索/更新补丁
import { describe, expect, it } from 'vitest';

import {
  NOTE_BODY_MAX,
  NOTE_SEARCH_MAX,
  NOTE_TITLE_MAX,
  NoteCreateReqSchema,
  NoteListReqSchema,
  NoteUpdateReqSchema,
} from '../schemas/notes';

describe('notes schemas', () => {
  it('标题 trim 后非空且不超过上限', () => {
    expect(NoteCreateReqSchema.safeParse({ title: '  Hello  ', body: '' }).success).toBe(true);
    expect(NoteCreateReqSchema.safeParse({ title: '   ', body: '' }).success).toBe(false);
    expect(
      NoteCreateReqSchema.safeParse({ title: 'x'.repeat(NOTE_TITLE_MAX + 1), body: '' }).success,
    ).toBe(false);
  });

  it('正文允许为空但拒绝超长', () => {
    expect(NoteCreateReqSchema.safeParse({ title: 'T', body: '' }).success).toBe(true);
    expect(
      NoteCreateReqSchema.safeParse({ title: 'T', body: 'x'.repeat(NOTE_BODY_MAX + 1) }).success,
    ).toBe(false);
  });

  it('搜索词 trim 且超长拒绝', () => {
    expect(NoteListReqSchema.parse({ query: '  hello  ' }).query).toBe('hello');
    expect(NoteListReqSchema.safeParse({ query: 'x'.repeat(NOTE_SEARCH_MAX + 1) }).success).toBe(
      false,
    );
  });

  it('更新必须至少提供 title 或 body', () => {
    expect(NoteUpdateReqSchema.safeParse({ id: 'n1' }).success).toBe(false);
    expect(NoteUpdateReqSchema.safeParse({ id: 'n1', body: 'next' }).success).toBe(true);
  });
});
