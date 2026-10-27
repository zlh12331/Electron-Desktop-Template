// language.ts：语言设置值域与“跟随系统”解析（main / renderer 共用纯函数）
// 边界：只做值域判定与 locale → 受支持语言映射；OS locale 的读取由各进程入口负责

/** 受支持的实际语言（i18next / 主进程词典只有这两套） */
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;

/** 受支持的实际语言类型 */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 设置值域：system = 跟随系统，其余为显式语言 */
export const LANGUAGE_SETTINGS = ['system', ...SUPPORTED_LANGUAGES] as const;

/** 设置值类型 */
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number];

/** 无法解析时回落的最后一级语言（默认设置由 DEFAULT_LANGUAGE_SETTING 决定） */
export const FALLBACK_LANGUAGE: SupportedLanguage = 'zh-CN';

/**
 * 把 OS locale 归一为受支持语言
 *
 * 只区分中文与非中文：zh-CN / zh-TW / zh-HK → zh-CN；其余 → en。
 * 缺失/空串回落模板默认中文。
 */
export function resolveLanguageFromLocale(locale: unknown): SupportedLanguage {
  if (typeof locale !== 'string' || locale.trim().length === 0) {
    return FALLBACK_LANGUAGE;
  }
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

/**
 * 把持久化设置值解析为实际语言
 *
 * system 走 locale；显式语言原样返回；损坏/缺失回落中文。
 */
export function resolveLanguageSetting(value: unknown, locale?: unknown): SupportedLanguage {
  if (value === 'en' || value === 'zh-CN') {
    return value;
  }
  if (value === 'system') {
    return resolveLanguageFromLocale(locale);
  }
  return FALLBACK_LANGUAGE;
}
