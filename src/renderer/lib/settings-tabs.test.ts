import { describe, expect, it } from 'vitest';
import { resolveNextTabIndex } from './settings-tabs';

describe('resolveNextTabIndex', () => {
  it('ArrowDown：顺序前进，末项环绕到首项', () => {
    expect(resolveNextTabIndex('ArrowDown', 0, 3)).toBe(1);
    expect(resolveNextTabIndex('ArrowDown', 2, 3)).toBe(0);
  });

  it('ArrowUp：顺序后退，首项环绕到末项', () => {
    expect(resolveNextTabIndex('ArrowUp', 2, 3)).toBe(1);
    expect(resolveNextTabIndex('ArrowUp', 0, 3)).toBe(2);
  });

  it('Home/End：直达首/末项', () => {
    expect(resolveNextTabIndex('Home', 2, 3)).toBe(0);
    expect(resolveNextTabIndex('End', 0, 3)).toBe(2);
  });

  it('焦点不在任何 tab 上（-1）：ArrowDown 到首项，ArrowUp 到末项', () => {
    expect(resolveNextTabIndex('ArrowDown', -1, 3)).toBe(0);
    expect(resolveNextTabIndex('ArrowUp', -1, 3)).toBe(2);
  });

  it('单项列表：方向键停留在该项', () => {
    expect(resolveNextTabIndex('ArrowDown', 0, 1)).toBe(0);
    expect(resolveNextTabIndex('ArrowUp', 0, 1)).toBe(0);
  });
});
