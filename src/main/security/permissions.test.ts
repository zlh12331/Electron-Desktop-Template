import { describe, expect, it } from 'vitest';
import { CLIPBOARD_WRITE_PERMISSION, isAllowedRendererPermission } from './permissions';

describe('isAllowedRendererPermission', () => {
  it('仅放行剪贴板写', () => {
    expect(isAllowedRendererPermission(CLIPBOARD_WRITE_PERMISSION)).toBe(true);
    expect(CLIPBOARD_WRITE_PERMISSION).toBe('clipboard-sanitized-write');
  });

  it('读取剪贴板与其他权限保持拒绝', () => {
    for (const permission of [
      'clipboard-read',
      'media',
      'notifications',
      'geolocation',
      'midi',
      'pointerLock',
      '',
    ]) {
      expect(isAllowedRendererPermission(permission)).toBe(false);
    }
  });
});
