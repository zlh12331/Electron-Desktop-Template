import type { Note, NoteSummary } from '@code-agent/shared/renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ipcOk } from '@/lib/ipc-factories';

import {
  NOTES_QUERY_KEY,
  useCreateNote,
  useDeleteNote,
  useExportNote,
  useImportNote,
  useNoteQuery,
  useNotesQuery,
  useUpdateNote,
} from './use-notes';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const NOTE: Note = {
  id: 'n1',
  title: '第一条',
  body: '正文',
  createdAt: 1,
  updatedAt: 2,
};

const SUMMARY: NoteSummary = { id: 'n1', title: '第一条', preview: '正文', updatedAt: 2 };

type NotesApi = {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  importFile: ReturnType<typeof vi.fn>;
  exportFile: ReturnType<typeof vi.fn>;
};

function mockNotesApi(impl: Partial<NotesApi>): void {
  (window.api as unknown as Record<string, unknown>)['notes'] = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    importFile: vi.fn(),
    exportFile: vi.fn(),
    ...impl,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, queryClient };
}

describe('use-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('列表：空搜索不传 query，非空搜索去空格后传参', async () => {
    const list = vi.fn(async () => ipcOk({ notes: [SUMMARY] }));
    mockNotesApi({ list });
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useNotesQuery(query),
      { initialProps: { query: '  ' }, wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list).toHaveBeenCalledWith({});
    expect(result.current.data).toEqual([SUMMARY]);

    rerender({ query: '  标题  ' });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ query: '标题' }));
  });

  it('列表：无桥时降级为空数组', async () => {
    (window as unknown as { api: undefined }).api = undefined;
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useNotesQuery(''), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('详情：id 为空不发请求，有 id 时解包 note', async () => {
    const get = vi.fn(async () => ipcOk({ note: NOTE }));
    mockNotesApi({ get });
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useNoteQuery(id),
      { initialProps: { id: undefined } as { id: string | undefined }, wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();

    rerender({ id: 'n1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith({ id: 'n1' });
    expect(result.current.data).toEqual(NOTE);
  });

  it('创建/更新/删除/导入：调用对应通道并使 notes 根 key 失效', async () => {
    const create = vi.fn(async () => ipcOk({ note: NOTE }));
    const update = vi.fn(async () => ipcOk({ note: NOTE }));
    const del = vi.fn(async () => ipcOk({ ok: true }));
    const importFile = vi.fn(async () => ipcOk({ note: NOTE }));
    mockNotesApi({ create, update, delete: del, importFile });
    const { wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const created = renderHook(() => useCreateNote(), { wrapper });
    created.result.current.mutate({ title: '第一条', body: '正文' });
    await waitFor(() => expect(created.result.current.isSuccess).toBe(true));
    expect(create).toHaveBeenCalledWith({ title: '第一条', body: '正文' });

    const updated = renderHook(() => useUpdateNote(), { wrapper });
    updated.result.current.mutate({ id: 'n1', body: '新正文' });
    await waitFor(() => expect(updated.result.current.isSuccess).toBe(true));
    expect(update).toHaveBeenCalledWith({ id: 'n1', body: '新正文' });

    const deleted = renderHook(() => useDeleteNote(), { wrapper });
    deleted.result.current.mutate('n1');
    await waitFor(() => expect(deleted.result.current.isSuccess).toBe(true));
    expect(del).toHaveBeenCalledWith({ id: 'n1' });

    const imported = renderHook(() => useImportNote(), { wrapper });
    imported.result.current.mutate('/tmp/a.md');
    await waitFor(() => expect(imported.result.current.isSuccess).toBe(true));
    expect(importFile).toHaveBeenCalledWith({ path: '/tmp/a.md' });

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy).toHaveBeenCalledWith({ queryKey: NOTES_QUERY_KEY });
  });

  it('导出：返回保存结果且不触发列表失效', async () => {
    const exportFile = vi.fn(async () => ipcOk({ saved: true, path: '/tmp/a.md' }));
    mockNotesApi({ exportFile });
    const { wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useExportNote(), { wrapper });
    result.current.mutate('n1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(exportFile).toHaveBeenCalledWith({ id: 'n1' });
    expect(result.current.data).toEqual({ saved: true, path: '/tmp/a.md' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('写路径失败：toast 展示解包后的错误', async () => {
    mockNotesApi({ delete: vi.fn(async () => Promise.reject(new Error('disk full'))) });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteNote(), { wrapper });

    result.current.mutate('n1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('disk full');
  });
});
