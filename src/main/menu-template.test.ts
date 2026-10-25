import { describe, expect, it } from 'vitest';

import { buildProductionMenuTemplate } from './menu-template';

function roles(template: ReturnType<typeof buildProductionMenuTemplate>): string[] {
  return template.map((item) => item.role ?? '');
}

describe('buildProductionMenuTemplate', () => {
  it('Windows/Linux：保留 File/Edit/Window，不含 View/Reload/DevTools', () => {
    const template = buildProductionMenuTemplate('win32');
    expect(roles(template)).toEqual(['fileMenu', 'editMenu', 'windowMenu']);
    expect(roles(template)).not.toContain('viewMenu');
  });

  it('macOS：使用 appMenu + Edit + Window，不含 View', () => {
    const template = buildProductionMenuTemplate('darwin');
    expect(roles(template)).toEqual(['appMenu', 'editMenu', 'windowMenu']);
    expect(roles(template)).not.toContain('viewMenu');
  });
});
