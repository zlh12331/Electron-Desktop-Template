import type { SupportedLanguage } from '@/i18n/config';

/** 实际语言 → 该语言的自称（语言选择器显示用；system 由 UI 单独本地化） */
export const LANGUAGE_ENDONYMS: Readonly<Record<SupportedLanguage, string>> = {
  'zh-CN': '简体中文',
  en: 'English',
};
