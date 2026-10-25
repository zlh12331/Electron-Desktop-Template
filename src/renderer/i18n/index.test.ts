import { describe, expect, it } from 'vitest';

import { I18nProvider, i18n } from './index';

describe('i18n barrel', () => {
  it('导出 i18n 实例与 Provider', () => {
    expect(i18n).toBeDefined();
    expect(I18nProvider).toBeTypeOf('function');
  });

  it('初始语言是支持的语言', () => {
    expect(['zh-CN', 'en']).toContain(i18n.language);
  });
});
