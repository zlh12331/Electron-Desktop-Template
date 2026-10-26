import type { NoteSummary } from '@code-agent/shared/renderer';
import { Plus, Search, Upload } from 'lucide-react';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useTranslation } from '@/i18n/use-translation';
import { cn } from '@/lib/utils';

interface NoteListProps {
  readonly notes: readonly NoteSummary[];
  readonly selectedId: string | undefined;
  readonly query: string;
  readonly loading: boolean;
  readonly importing: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
  readonly onImport: () => void;
}

/** 笔记列表与搜索（Local Notes 参考切片的展示层） */
export function NoteList({
  notes,
  selectedId,
  query,
  loading,
  importing,
  onQueryChange,
  onSelect,
  onCreate,
  onImport,
}: NoteListProps): ReactElement {
  const { t } = useTranslation();
  const searching = query.trim().length > 0;

  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label={t('notes.listAria')}>
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1" onClick={onCreate}>
            <Plus className="size-3.5" />
            {t('notes.new')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={importing}
            onClick={onImport}
            title={t('notes.import')}
          >
            <Upload className="size-3.5" />
            <span className="sr-only">{t('notes.import')}</span>
          </Button>
        </div>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
          <Input
            aria-label={t('notes.search')}
            className="h-8 pl-8 text-xs"
            placeholder={t('notes.search')}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-4" />
          </div>
        ) : notes.length === 0 ? (
          <EmptyState
            title={searching ? t('common.noResults') : t('notes.emptyTitle')}
            description={searching ? t('notes.searchEmptyDesc') : t('notes.emptyDesc')}
            {...(searching ? {} : { actionLabel: t('notes.new'), onAction: onCreate })}
            className="py-10"
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {notes.map((note) => (
              <li key={note.id}>
                <Button
                  variant="ghost"
                  aria-current={note.id === selectedId ? 'true' : undefined}
                  className={cn(
                    'hover:bg-muted/70 h-auto w-full flex-col items-start gap-0 rounded-md px-2.5 py-2 text-left font-normal whitespace-normal',
                    note.id === selectedId && 'bg-muted hover:bg-muted',
                  )}
                  onClick={() => onSelect(note.id)}
                >
                  <span className="text-foreground w-full truncate text-sm font-medium">
                    {note.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                    {note.preview || t('notes.emptyPreview')}
                  </span>
                  <span className="text-muted-foreground mt-1 font-mono text-2xs">
                    {t('notes.updatedAt', { time: new Date(note.updatedAt).toLocaleString() })}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
