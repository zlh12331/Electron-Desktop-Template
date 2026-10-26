import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';
import { Toaster } from './sonner';
import { TooltipProvider } from './tooltip';

vi.mock('@/providers/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));

describe('UI wrappers', () => {
  it('Sheet 渲染 dialog、标题与描述', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>标题</SheetTitle>
          <SheetDescription>描述</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('描述')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull();
  });

  it('withOverlay=false 不渲染全屏遮罩（省合成层）', () => {
    render(
      <Sheet open>
        <SheetContent withOverlay={false}>
          <SheetTitle>标题</SheetTitle>
          <SheetDescription>描述</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
  });

  it('Toaster 在主题 provider 下可渲染', () => {
    const { container } = render(<Toaster />);

    expect(container).toBeInTheDocument();
  });

  it('TooltipProvider 透传子节点', () => {
    render(
      <TooltipProvider>
        <span>tooltip-trigger</span>
      </TooltipProvider>,
    );

    expect(screen.getByText('tooltip-trigger')).toBeInTheDocument();
  });
});
