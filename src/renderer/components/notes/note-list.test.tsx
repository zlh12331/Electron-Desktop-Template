import type { NoteSummary } from '@code-agent/shared/renderer';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';

import { NoteList } from './note-list';

const t = i18n.t.bind(i18n);

const NOTES: readonly NoteSummary[] = [
  { id: 'n1', title: '第一条', preview: '预览一', updatedAt: Date.parse('2026-10-26T10:00:00Z') },
  { id: 'n2', title: '第二条', preview: '', updatedAt: Date.parse('2026-10-26T11:00:00Z') },
];

function renderList(overrides: Partial<Parameters<typeof NoteList>[0]> = {}) {
  const props = {
    notes: NOTES,
    selectedId: undefined as string | undefined,
    query: '',
    loading: false,
    importing: false,
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  };
  render(<NoteList {...props} />);
  return props;
}

describe('NoteList', () => {
  it('渲染标题、预览与空正文占位，选中项标记 aria-current', () => {
    renderList({ selectedId: 'n2' });

    expect(screen.getByText('第一条')).toBeDefined();
    expect(screen.getByText('预览一')).toBeDefined();
    expect(screen.getByText(t('notes.emptyPreview'))).toBeDefined();

    const selected = screen.getByText('第二条').closest('button');
    expect(selected?.getAttribute('aria-current')).toBe('true');
  });

  it('点击条目与新建/导入按钮分别上抛回调', async () => {
    const props = renderList();

    await userEvent.click(screen.getByText('第一条'));
    expect(props.onSelect).toHaveBeenCalledWith('n1');

    await userEvent.click(screen.getByRole('button', { name: t('notes.new') }));
    expect(props.onCreate).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: t('notes.import') }));
    expect(props.onImport).toHaveBeenCalled();
  });

  it('搜索输入逐字上抛', async () => {
    const props = renderList();
    await userEvent.type(screen.getByRole('textbox', { name: t('notes.search') }), 'ab');

    expect(props.onQueryChange).toHaveBeenCalledWith('a');
  });

  it('空列表展示空态，空态按钮复用新建回调', async () => {
    const props = renderList({ notes: [] });

    expect(screen.getByText(t('notes.emptyTitle'))).toBeDefined();
    const newButtons = screen.getAllByRole('button', { name: t('notes.new') });
    expect(newButtons).toHaveLength(2);
    await userEvent.click(newButtons[1] as HTMLElement);
    expect(props.onCreate).toHaveBeenCalled();
  });

  it('加载中展示状态指示器而非空态', () => {
    renderList({ notes: [], loading: true });

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.queryByText(t('notes.emptyTitle'))).toBeNull();
  });
});
