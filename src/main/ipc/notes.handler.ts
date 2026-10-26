// notes.handler.ts：Local Notes 参考切片的主进程 handler——CRUD + Markdown 导入/导出
// 导入路径必须来自 dialog:pickFiles 的 user-grants 授权；写操作统一广播 notes 失效域。
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';
import {
  AppError,
  ErrorCode,
  INVALIDATION_DOMAINS,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
} from '@code-agent/shared/main';
import { app, dialog } from 'electron';

import { isUserGrantedRead } from '../infra/file/user-grants';
import { broadcastInvalidation } from '../infra/invalidation/invalidation';
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  updateNote,
} from '../infra/notes/notes-repository';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

/** 导入文件字节上限：正文另有字符上限，先挡住超大文件 */
const MAX_IMPORT_BYTES = 256 * 1024;

function titleFromFile(filePath: string, content: string): string {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  const fallback = basename(filePath, extname(filePath)).trim() || 'Imported note';
  return (heading ?? fallback).slice(0, NOTE_TITLE_MAX);
}

function safeExportName(title: string, id: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : id;
}

function noteNotFound(): AppError {
  return new AppError(ErrorCode.NOT_FOUND, '笔记不存在');
}

/** Local Notes 域 handler（依赖仅 repository/文件授权，可直接替换为业务实现） */
export const notesHandlers: InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['notes'] = {
  list: async (input) => {
    return { notes: listNotes(input.query) };
  },

  get: async (input) => {
    const note = getNote(input.id);
    if (note === null) {
      throw noteNotFound();
    }
    return { note };
  },

  create: async (input) => {
    const note = createNote({ title: input.title, body: input.body });
    broadcastInvalidation([INVALIDATION_DOMAINS.notes], note.id);
    logger.info({ id: note.id }, '笔记已创建');
    return { note };
  },

  update: async (input) => {
    const note = updateNote(input.id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });
    if (note === null) {
      throw noteNotFound();
    }
    broadcastInvalidation([INVALIDATION_DOMAINS.notes], note.id);
    logger.info({ id: note.id }, '笔记已更新');
    return { note };
  },

  delete: async (input) => {
    if (!deleteNote(input.id)) {
      throw noteNotFound();
    }
    broadcastInvalidation([INVALIDATION_DOMAINS.notes], input.id);
    logger.info({ id: input.id }, '笔记已删除');
    return { ok: true };
  },

  importFile: async (input) => {
    if (!isUserGrantedRead(input.path)) {
      throw new AppError(ErrorCode.UNAUTHORIZED, '导入文件未获得用户授权');
    }
    try {
      const info = await stat(input.path);
      if (!info.isFile()) {
        throw new AppError(ErrorCode.INVALID_INPUT, '导入目标不是文件');
      }
      if (info.size > MAX_IMPORT_BYTES) {
        throw new AppError(ErrorCode.INVALID_INPUT, '导入文件过大（上限 256KB）');
      }
      const content = await readFile(input.path, 'utf8');
      if (content.length > NOTE_BODY_MAX) {
        throw new AppError(ErrorCode.INVALID_INPUT, '导入内容超过笔记正文上限');
      }
      const note = createNote({ title: titleFromFile(input.path, content), body: content });
      broadcastInvalidation([INVALIDATION_DOMAINS.notes], note.id);
      logger.info({ id: note.id }, '笔记已从文件导入');
      return { note };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(ErrorCode.FS_READ_FAILED, '读取导入文件失败', error);
    }
  },

  exportFile: async (input) => {
    const note = getNote(input.id);
    if (note === null) {
      throw noteNotFound();
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出笔记',
      defaultPath: join(app.getPath('documents'), `${safeExportName(note.title, note.id)}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || filePath === undefined || filePath === '') {
      return { saved: false };
    }
    try {
      await writeFile(filePath, `# ${note.title}\n\n${note.body}\n`, 'utf8');
      logger.info({ id: note.id }, '笔记已导出');
      return { saved: true, path: filePath };
    } catch (error) {
      throw new AppError(ErrorCode.FS_WRITE_FAILED, '写入导出文件失败', error);
    }
  },
};
