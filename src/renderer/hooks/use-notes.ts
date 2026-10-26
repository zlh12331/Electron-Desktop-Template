import type { Note, NoteSummary } from '@code-agent/shared/renderer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useErrorMessage } from '@/i18n/use-translation';
import { hasIpcBridge, unwrap, unwrapErrorMessage } from '@/lib/ipc';

// notes-example:start
/** 笔记所有查询的根 key（失效时同时刷新列表与详情） */
export const NOTES_QUERY_KEY = ['notes'] as const;

const NOTES_LIST_QUERY_KEY = (query: string) => ['notes', 'list', { query }] as const;
const NOTES_DETAIL_QUERY_KEY = (id: string) => ['notes', 'detail', id] as const;

/**
 * 笔记列表查询（搜索词为空返回全部）
 *
 * @param query 搜索词
 */
export function useNotesQuery(query: string) {
  const keyword = query.trim();
  return useQuery({
    queryKey: NOTES_LIST_QUERY_KEY(keyword),
    queryFn: async (): Promise<readonly NoteSummary[]> => {
      if (!hasIpcBridge()) {
        return [];
      }
      const input = keyword.length === 0 ? {} : { query: keyword };
      return unwrap(await window.api.notes.list(input)).notes;
    },
    staleTime: 5_000,
  });
}

/**
 * 单条笔记查询
 *
 * @param id 笔记 id；undefined 时不发请求
 */
export function useNoteQuery(id: string | undefined) {
  return useQuery({
    queryKey: NOTES_DETAIL_QUERY_KEY(id ?? ''),
    queryFn: async (): Promise<Note | null> => {
      if (id === undefined || !hasIpcBridge()) {
        return null;
      }
      return unwrap(await window.api.notes.get({ id })).note;
    },
    enabled: id !== undefined,
  });
}

/**
 * 创建笔记
 */
export function useCreateNote() {
  const queryClient = useQueryClient();
  const { getErrorMessage } = useErrorMessage();
  return useMutation({
    mutationFn: async (input: { title: string; body: string }): Promise<Note> => {
      return unwrap(await window.api.notes.create(input)).note;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error as Error, getErrorMessage));
    },
  });
}

/**
 * 更新笔记
 */
export function useUpdateNote() {
  const queryClient = useQueryClient();
  const { getErrorMessage } = useErrorMessage();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      title?: string | undefined;
      body?: string | undefined;
    }): Promise<Note> => {
      return unwrap(await window.api.notes.update(input)).note;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error as Error, getErrorMessage));
    },
  });
}

/**
 * 删除笔记
 */
export function useDeleteNote() {
  const queryClient = useQueryClient();
  const { getErrorMessage } = useErrorMessage();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      unwrap(await window.api.notes.delete({ id }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error as Error, getErrorMessage));
    },
  });
}

/**
 * 从用户已授权的文件导入笔记
 */
export function useImportNote() {
  const queryClient = useQueryClient();
  const { getErrorMessage } = useErrorMessage();
  return useMutation({
    mutationFn: async (path: string): Promise<Note> => {
      return unwrap(await window.api.notes.importFile({ path })).note;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error as Error, getErrorMessage));
    },
  });
}

/**
 * 导出笔记到 Markdown
 */
export function useExportNote() {
  const { getErrorMessage } = useErrorMessage();
  return useMutation({
    mutationFn: async (id: string) => {
      return unwrap(await window.api.notes.exportFile({ id }));
    },
    onError: (error) => {
      toast.error(unwrapErrorMessage(error as Error, getErrorMessage));
    },
  });
}
// notes-example:end
