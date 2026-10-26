import type { Note } from '@code-agent/shared/renderer';
import { Download, Save, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n/use-translation';

interface NoteEditorProps {
  readonly note: Note;
  readonly saving: boolean;
  readonly deleting: boolean;
  readonly exporting: boolean;
  readonly onSave: (input: { title: string; body: string }) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
}

/** 笔记编辑器（局部状态以 note 为初始值；父组件用 key 切换笔记） */
export function NoteEditor({
  note,
  saving,
  deleting,
  exporting,
  onSave,
  onDelete,
  onExport,
}: NoteEditorProps): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const dirty = title !== note.title || body !== note.body;
  const canSave = title.trim().length > 0 && dirty && !saving;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="note-title" className="text-xs">
            {t('notes.titleLabel')}
          </Label>
          <span className="text-muted-foreground ml-auto font-mono text-2xs">
            {t('notes.characters', { value: body.length })}
          </span>
        </div>
        <Input
          id="note-title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <Label htmlFor="note-body" className="text-xs">
          {t('notes.bodyLabel')}
        </Label>
        <Textarea
          id="note-body"
          className="min-h-0 flex-1 resize-none font-mono"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        <Button size="sm" disabled={!canSave} onClick={() => onSave({ title: title.trim(), body })}>
          <Save className="size-3.5" />
          {saving ? t('notes.saving') : t('notes.save')}
        </Button>
        <Button variant="outline" size="sm" disabled={exporting} onClick={onExport}>
          <Download className="size-3.5" />
          {exporting ? t('notes.exporting') : t('notes.export')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive ml-auto"
          disabled={deleting}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
          {deleting ? t('notes.deleting') : t('notes.delete')}
        </Button>
      </div>
    </div>
  );
}
