import type { Note } from '@code-agent/shared/renderer';
import { type ReactElement, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/EmptyState';
import { MotionReveal } from '@/components/common/MotionReveal';
import { NoteEditor } from '@/components/notes/note-editor';
import { NoteList } from '@/components/notes/note-list';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  useCreateNote,
  useDeleteNote,
  useExportNote,
  useImportNote,
  useNoteQuery,
  useNotesQuery,
  useUpdateNote,
} from '@/hooks/use-notes';
import { useTranslation } from '@/i18n/use-translation';
import { ROUTES } from '@/lib/constants';
import { pickFiles } from '@/lib/dialog-actions';
import { confirm } from '@/stores/transient/confirm-dialog-store';

/**
 * Local Notes 参考切片：列表 + 编辑器 + 搜索 + 导入导出 + 深链目标
 *
 * 这是模板唯一有意保留的业务示例；`init:template` 默认删除整套示例。
 */
export function NotesPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id: string }>();
  const [search, setSearch] = useState('');

  const notesQuery = useNotesQuery(search);
  const noteQuery = useNoteQuery(selectedId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const importNote = useImportNote();
  const exportNote = useExportNote();

  const note = noteQuery.data ?? null;
  const notes = notesQuery.data ?? [];

  const handleCreate = async (): Promise<void> => {
    try {
      const created = await createNote.mutateAsync({ title: t('notes.untitled'), body: '' });
      navigate(ROUTES.note(created.id));
      toast.success(t('notes.created'));
    } catch {}
  };

  const handleImport = async (): Promise<void> => {
    const picked = await pickFiles({ multiple: false });
    const path = picked.paths?.[0];
    if (picked.canceled || path === undefined) {
      return;
    }
    try {
      const imported = await importNote.mutateAsync(path);
      navigate(ROUTES.note(imported.id));
      toast.success(t('notes.imported', { title: imported.title }));
    } catch {}
  };

  const handleSave = async (input: { title: string; body: string }): Promise<void> => {
    if (selectedId === undefined) {
      return;
    }
    try {
      await updateNote.mutateAsync({ id: selectedId, ...input });
      toast.success(t('notes.saved'));
    } catch {}
  };

  const handleDelete = async (): Promise<void> => {
    if (note === null) {
      return;
    }
    const confirmed = await confirm({
      title: t('notes.deleteTitle'),
      message: t('notes.deleteMessage', { title: note.title }),
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteNote.mutateAsync(note.id);
      navigate(ROUTES.notes);
      toast.success(t('notes.deleted'));
    } catch {}
  };

  const handleExport = async (): Promise<void> => {
    if (note === null) {
      return;
    }
    try {
      const result = await exportNote.mutateAsync(note.id);
      if (result.saved && result.path !== undefined) {
        toast.success(t('notes.exported', { path: result.path }));
      }
    } catch {}
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-foreground text-xl font-semibold tracking-tight">{t('notes.title')}</h1>
        <p className="text-muted-foreground text-xs leading-relaxed">{t('notes.subtitle')}</p>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="min-h-0 overflow-hidden p-0">
          <NoteList
            notes={notes}
            selectedId={selectedId}
            query={search}
            loading={notesQuery.isPending}
            importing={importNote.isPending}
            onQueryChange={setSearch}
            onSelect={(id) => navigate(ROUTES.note(id))}
            onCreate={() => void handleCreate()}
            onImport={() => void handleImport()}
          />
        </Card>

        <Card className="min-h-0 overflow-hidden p-0">
          <NotesDetail
            note={note}
            selectedId={selectedId}
            loading={noteQuery.isPending}
            saving={updateNote.isPending}
            deleting={deleteNote.isPending}
            exporting={exportNote.isPending}
            onCreate={() => void handleCreate()}
            onSave={(input) => void handleSave(input)}
            onDelete={() => void handleDelete()}
            onExport={() => void handleExport()}
          />
        </Card>
      </div>
    </div>
  );
}

interface NotesDetailProps {
  readonly note: Note | null;
  readonly selectedId: string | undefined;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly deleting: boolean;
  readonly exporting: boolean;
  readonly onCreate: () => void;
  readonly onSave: (input: { title: string; body: string }) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
}

/** 详情区：加载 / 空态 / 编辑器三态；独立成组件以隔离路由页的复杂度 */
function NotesDetail({
  note,
  selectedId,
  loading,
  saving,
  deleting,
  exporting,
  onCreate,
  onSave,
  onDelete,
  onExport,
}: NotesDetailProps): ReactElement {
  const { t } = useTranslation();
  const selectPrompt = note === null && selectedId === undefined;
  let content: ReactElement;
  if (loading && selectedId !== undefined) {
    content = (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  } else if (note === null) {
    content = (
      <EmptyState
        title={selectPrompt ? t('notes.selectPrompt') : t('notes.notFound')}
        description={selectPrompt ? t('notes.selectHint') : t('notes.notFoundHint')}
        {...(selectPrompt ? { actionLabel: t('notes.new'), onAction: onCreate } : {})}
        className="h-full"
      />
    );
  } else {
    content = (
      <NoteEditor
        key={`${note.id}:${note.updatedAt}`}
        note={note}
        saving={saving}
        deleting={deleting}
        exporting={exporting}
        onSave={onSave}
        onDelete={onDelete}
        onExport={onExport}
      />
    );
  }

  return (
    <MotionReveal key={`${note?.id ?? 'empty'}:${note?.updatedAt ?? 0}`} className="h-full">
      {content}
    </MotionReveal>
  );
}
