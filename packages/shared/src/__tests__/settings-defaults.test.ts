import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LANGUAGE_SETTING,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PROXY_SETTINGS,
  DEFAULT_THEME_SETTING,
  DEFAULT_UPDATE_SETTINGS,
  DEFAULT_WINDOW_SETTINGS,
} from '../index';

describe('settings-defaults', () => {
  it('渲染层与主进程共享的默认值保持稳定', () => {
    expect(DEFAULT_THEME_SETTING).toBe('system');
    expect(DEFAULT_LANGUAGE_SETTING).toBe('system');
    expect(DEFAULT_UPDATE_SETTINGS).toEqual({
      autoCheck: true,
      allowPrerelease: false,
      skippedVersion: null,
    });
    expect(DEFAULT_WINDOW_SETTINGS.closeAction).toBe('minimize');
    expect(DEFAULT_NOTIFICATION_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_PROXY_SETTINGS.mode).toBe('system');
  });
});
