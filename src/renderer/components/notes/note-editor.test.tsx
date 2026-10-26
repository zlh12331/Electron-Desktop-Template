import type { Note } from '@code-agent/shared/renderer';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';

import { NoteEditor } from './note-editor';

const t = i18n.t.bind(i18n);

const NOTE: Note = {
  id: 'n1',
  title: '旧标题',
  body: '旧正文',
  createdAt: 1,
  updatedAt: 2,
};

function renderEditor(overrides: Partial<Parameters<typeof NoteEditor>[0]> = {}) {
  const props = {
    note: NOTE,
    saving: false,
    deleting: false,
    exporting: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  };
  render(<NoteEditor {...props} />);
  return props;
}

describe('NoteEditor', () => {
  it('以 note 为初始值，未修改时保存不可用', () => {
    renderEditor();

    expect(screen.getByLabelText(t('notes.titleLabel'))).toHaveValue(NOTE.title);
    expect(screen.getByLabelText(t('notes.bodyLabel'))).toHaveValue(NOTE.body);
    expect(screen.getByRole('button', { name: t('notes.save') })).toBeDisabled();
  });

  it('修改标题后可保存，提交时标题去首尾空格', async () => {
    const props = renderEditor();
    const title = screen.getByLabelText(t('notes.titleLabel'));

    await userEvent.clear(title);
    await userEvent.type(title, '  新标题  ');
    await userEvent.click(screen.getByRole('button', { name: t('notes.save') }));

    expect(props.onSave).toHaveBeenCalledWith({ title: '新标题', body: NOTE.body });
  });

  it('标题清空后保存保持不可用', async () => {
    renderEditor();
    await userEvent.clear(screen.getByLabelText(t('notes.titleLabel')));

    expect(screen.getByRole('button', { name: t('notes.save') })).toBeDisabled();
  });

  it('正文修改更新字符计数', async () => {
    renderEditor();
    await userEvent.type(screen.getByLabelText(t('notes.bodyLabel')), 'abc');

    expect(screen.getByText(t('notes.characters', { value: 6 }))).toBeDefined();
  });

  it('导出与删除上抛回调，进行中展示对应文案并禁用', async () => {
    const props = renderEditor({ deleting: true, exporting: true });

    const exportButton = screen.getByRole('button', { name: t('notes.exporting') });
    const deleteButton = screen.getByRole('button', { name: t('notes.deleting') });
    expect(exportButton).toBeDisabled();
    expect(deleteButton).toBeDisabled();

    await userEvent.click(deleteButton);
    await userEvent.click(exportButton);
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onExport).not.toHaveBeenCalled();
  });

  it('空闲态点击导出与删除正常上抛', async () => {
    const props = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: t('notes.export') }));
    await userEvent.click(screen.getByRole('button', { name: t('notes.delete') }));

    expect(props.onExport).toHaveBeenCalled();
    expect(props.onDelete).toHaveBeenCalled();
  });
});
