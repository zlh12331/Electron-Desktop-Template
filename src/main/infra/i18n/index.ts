// i18n/index.ts：主进程侧最小翻译层——托盘等主进程 UI 的双语词典查找 + {param} 插值
// 边界：渲染层走 i18next 完整管线，两边不共用实现；语言真源在 settings.language
import { FALLBACK_LANGUAGE, resolveLanguageSetting } from '@code-agent/shared/main';
import { MAIN_DICTIONARIES, type MainLanguage } from './dictionaries';

export const DEFAULT_MAIN_LANGUAGE: MainLanguage = FALLBACK_LANGUAGE;

let currentLanguage: MainLanguage = DEFAULT_MAIN_LANGUAGE;

/** 把设置值 + OS locale 解析为双语之一；未知/损坏回落中文 */
function asMainLanguage(value: unknown, locale: string | undefined): MainLanguage {
  return resolveLanguageSetting(value, locale);
}

/** 启动序列调用：按 settings.language 初始化（system 用 app.getLocale 解析） */
export function initMainI18n(language: unknown, locale: string | undefined = 'zh-CN'): void {
  currentLanguage = asMainLanguage(language, locale);
}

/** 运行中切语言（settings:set 的 language 分支调用） */
export function setMainLanguage(value: unknown, locale: string | undefined = 'zh-CN'): void {
  currentLanguage = asMainLanguage(value, locale);
}

/** 当前语言（托盘菜单构建时读取） */
export function getMainLanguage(): MainLanguage {
  return currentLanguage;
}

// {name} 占位插值：参数缺失保留原占位符（便于发现词典/调用两侧不匹配）
function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 翻译：当前语言 → 默认语言 → key 本身三级回落（缺词条不炸，宁可露 key） */
export function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  const dict = MAIN_DICTIONARIES[currentLanguage];
  const fallback = MAIN_DICTIONARIES[DEFAULT_MAIN_LANGUAGE];
  const template = dict[key] ?? fallback[key] ?? key;
  return params === undefined ? template : interpolate(template, params);
}
