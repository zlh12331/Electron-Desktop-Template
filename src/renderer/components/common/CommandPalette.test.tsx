import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CommandPalette } from './CommandPalette';

function Harness(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <button type="button" onClick={() => setOpen(true)}>
        打开命令面板
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </MemoryRouter>
  );
}

describe('CommandPalette', () => {
  it('打开后聚焦搜索框、背景 inert，Tab 焦点限制在面板内', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开命令面板' });

    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '命令面板' });
    const input = dialog.querySelector<HTMLInputElement>('.palette-input');
    expect(input).not.toBeNull();
    await waitFor(() => expect(input).toHaveFocus());
    expect(trigger).toHaveAttribute('inert');
    expect(trigger).toHaveAttribute('aria-hidden', 'true');

    await user.tab();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape 关闭并把焦点还给触发器', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开命令面板' });

    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog', { name: '命令面板' })).toBeVisible());
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull());
    expect(trigger).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
  });
});
