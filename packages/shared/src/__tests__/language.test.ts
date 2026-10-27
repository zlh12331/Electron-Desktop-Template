import { describe, expect, it } from 'vitest';

import {
  FALLBACK_LANGUAGE,
  LANGUAGE_SETTINGS,
  resolveLanguageFromLocale,
  resolveLanguageSetting,
  SUPPORTED_LANGUAGES,
} from '../constants/language';

describe('language settings', () => {
  it('设置值域包含 system + 两套实际语言', () => {
    expect(LANGUAGE_SETTINGS).toEqual(['system', 'zh-CN', 'en']);
    expect(SUPPORTED_LANGUAGES).toEqual(['zh-CN', 'en']);
    expect(FALLBACK_LANGUAGE).toBe('zh-CN');
  });

  it('system → OS locale：中文族归 zh-CN，其他归 en，缺失回落中文', () => {
    expect(resolveLanguageFromLocale('zh-CN')).toBe('zh-CN');
    expect(resolveLanguageFromLocale('zh-TW')).toBe('zh-CN');
    expect(resolveLanguageFromLocale('en-US')).toBe('en');
    expect(resolveLanguageFromLocale('fr-FR')).toBe('en');
    expect(resolveLanguageFromLocale(undefined)).toBe('zh-CN');
    expect(resolveLanguageFromLocale('')).toBe('zh-CN');
  });

  it('显式语言原样返回，损坏值回落中文', () => {
    expect(resolveLanguageSetting('en', 'zh-CN')).toBe('en');
    expect(resolveLanguageSetting('zh-CN', 'en-US')).toBe('zh-CN');
    expect(resolveLanguageSetting('system', 'en-GB')).toBe('en');
    expect(resolveLanguageSetting('fr-FR', 'en-US')).toBe('zh-CN');
    expect(resolveLanguageSetting(undefined, 'en-US')).toBe('zh-CN');
  });
});
