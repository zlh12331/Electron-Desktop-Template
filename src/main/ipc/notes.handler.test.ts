import { AppError, ErrorCode, INVALIDATION_DOMAINS } from '@code-agent/shared/main';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  showSaveDialog: vi.fn(),
  getPath: vi.fn(() => 'C:/documents'),
  isUserGrantedRead: vi.fn(),
  broadcastInvalidation: vi.fn(),
  listNotes: vi.fn(),
  getNote: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}));

vi.mock('../infra/file/user-grants', () => ({ isUserGrantedRead: mocks.isUserGrantedRead }));
vi.mock('../infra/invalidation/invalidation', () => ({
  broadcastInvalidation: mocks.broadcastInvalidation,
}));
vi.mock('../infra/notes/notes-repository', () => ({
  listNotes: mocks.listNotes,
  getNote: mocks.getNote,
  createNote: mocks.createNote,
  updateNote: mocks.updateNote,
  deleteNote: mocks.deleteNote,
}));
vi.mock('../utils/logger', () => ({ logger: mocks.logger }));

import { notesHandlers } from './notes.handler';

type TestHandler = (input: unknown) => Promise<unknown>;
/** handler 运行时还接收 ctx；本测试只验证 input→repository/副作用，用单参视图简化调用 */
const handlers = notesHandlers as unknown as Record<keyof typeof notesHandlers, TestHandler>;

const note = {
  id: 'n1',
  title: 'Title',
  body: 'Body',
  createdAt: 1,
  updatedAt: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPath.mockReturnValue('C:/documents');
});

describe('notes handler', () => {
  it('list/get 走 repository；缺失返回 NOT_FOUND', async () => {
    mocks.listNotes.mockReturnValue([]);
    await expect(handlers.list({ query: 'x' })).resolves.toEqual({ notes: [] });
    expect(mocks.listNotes).toHaveBeenCalledWith('x');

    mocks.getNote.mockReturnValue(null);
    await expect(handlers.get({ id: 'n1' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('create/update/delete 写后广播 notes 失效域', async () => {
    mocks.createNote.mockReturnValue(note);
    await expect(handlers.create({ title: 'Title', body: 'Body' })).resolves.toEqual({
      note,
    });
    expect(mocks.broadcastInvalidation).toHaveBeenCalledWith([INVALIDATION_DOMAINS.notes], 'n1');

    mocks.updateNote.mockReturnValue({ ...note, body: 'next' });
    await expect(handlers.update({ id: 'n1', body: 'next' })).resolves.toMatchObject({
      note: { body: 'next' },
    });

    mocks.deleteNote.mockReturnValue(false);
    await expect(handlers.delete({ id: 'n1' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    mocks.deleteNote.mockReturnValue(true);
    await expect(handlers.delete({ id: 'n1' })).resolves.toEqual({ ok: true });
    expect(mocks.broadcastInvalidation).toHaveBeenCalledTimes(3);
  });

  it('导入拒绝未授权路径，授权后从标题/正文创建', async () => {
    mocks.isUserGrantedRead.mockReturnValue(false);
    await expect(handlers.importFile({ path: 'C:/tmp/a.md' })).rejects.toBeInstanceOf(AppError);

    mocks.isUserGrantedRead.mockReturnValue(true);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 10 });
    mocks.readFile.mockResolvedValue('# Imported title\n\nbody');
    mocks.createNote.mockReturnValue({ ...note, title: 'Imported title' });

    await expect(handlers.importFile({ path: 'C:/tmp/a.md' })).resolves.toMatchObject({
      note: { title: 'Imported title' },
    });
    expect(mocks.createNote).toHaveBeenCalledWith({
      title: 'Imported title',
      body: '# Imported title\n\nbody',
    });
  });

  it('导出取消返回 saved=false；保存成功写入 Markdown', async () => {
    mocks.getNote.mockReturnValue(note);
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await expect(handlers.exportFile({ id: 'n1' })).resolves.toEqual({ saved: false });

    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/out/title.md' });
    mocks.writeFile.mockResolvedValue(undefined);
    await expect(handlers.exportFile({ id: 'n1' })).resolves.toEqual({
      saved: true,
      path: 'C:/out/title.md',
    });
    expect(mocks.writeFile).toHaveBeenCalledWith('C:/out/title.md', '# Title\n\nBody\n', 'utf8');
  });

  it('导入超限/非文件返回 INVALID_INPUT', async () => {
    mocks.isUserGrantedRead.mockReturnValue(true);
    mocks.stat.mockResolvedValue({ isFile: () => false, size: 1 });
    await expect(handlers.importFile({ path: 'C:/tmp/a.md' })).rejects.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
    });

    mocks.stat.mockResolvedValue({ isFile: () => true, size: 300 * 1024 });
    await expect(handlers.importFile({ path: 'C:/tmp/a.md' })).rejects.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
    });
  });
});
