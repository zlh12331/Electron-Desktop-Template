import { STORAGE_PREFIX } from '@code-agent/shared/renderer';
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import zhCNCommon from './locales/zh-CN/common.json';
import zhCNErrors from './locales/zh-CN/errors.json';

/** 支持的语言列表（用于语言切换 UI） */
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;

/** 支持的语言类型 */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 默认语言（也是 fallback 语言） */
const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN';

/** localStorage key（与 settings-store 的前缀对齐） */
export const LANGUAGE_STORAGE_KEY = `${STORAGE_PREFIX}:lang`;

/**
 * i18next 资源结构
 *
 * 结构：{ 语言: { namespace: {...} } }
 * JSON 文件与命名空间一一对应、扁平无包装（2026-09-17 移除旧 "translation"
 * 顶层包装——扁平结构是 i18next-cli 与 IDE i18n 插件解析语言包的预期形态，
 * 包装曾导致所有 key 被工具判定为缺失）
 */
export const resources = {
  'zh-CN': {
    common: zhCNCommon,
    errors: zhCNErrors,
  },
  en: {
    common: enCommon,
    errors: enErrors,
  },
} as const;

/** i18next 初始化配置 */
const i18nOptions = {
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  defaultNS: 'common',
  ns: ['common', 'errors'],
  interpolation: {
    escapeValue: false,
  },
  detection: {
    order: ['localStorage', 'navigator'],
    lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    cachesLocalStorage: ['localStorage'],
  },
  react: {
    useSuspense: false,
  },
};

/** 初始化标志，防止重复 init */
let initialized = false;

/** 同步 <html lang>（语言切换时供屏幕阅读器与浏览器正确处理发音/断词） */
function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
}

/**
 * 初始化 i18next（资源已内联，初始化后即可查询文案）
 *
 * 以默认语言同步起步；SQLite 快照的真源应用发生在 main.tsx 首帧渲染前
 * （见 changeLanguage）。LanguageDetector 只在未显式指定 lng 时参与检测，
 * 模板不使用该路径，保留插件是为了浏览器模式与未来独立渲染入口。
 */
export function initI18n(): typeof i18next {
  if (initialized) {
    return i18next;
  }
  initialized = true;

  void i18next.use(initReactI18next).use(LanguageDetector).init(i18nOptions);
  i18next.on('languageChanged', syncHtmlLang);
  if (i18next.language !== undefined) {
    syncHtmlLang(i18next.language);
  }

  return i18next;
}

/** i18next 实例（供非 React 代码使用，如工具函数直接调用 t()） */
export const i18n = i18next;

/**
 * 当前语言（供非 React 代码读取）
 *
 * 注（2026-09-08 死代码核实）：当前无生产消费方，但 i18n-gaps.test.ts 有覆盖
 * ——按「测试专用导出」保留。
 */
export function getCurrentLanguage(): SupportedLanguage {
  const current = i18next.language ?? DEFAULT_LANGUAGE;
  return current as SupportedLanguage;
}

/**
 * 把任意持久化值收窄为受支持语言（损坏/缺失回落默认语言）
 *
 * 启动快照来自 SQLite，不能假设历史数据一定合法。
 */
export function resolveLanguage(value: unknown): SupportedLanguage {
  return value === 'en' || value === 'zh-CN' ? value : DEFAULT_LANGUAGE;
}

/**
 * 切换语言并等待 i18next 完成应用
 *
 * 返回 Promise 是为了让启动路径能在首帧渲染前 await，避免先渲染中文再闪成英文；
 * 切换后 i18next 会自动写入 localStorage（由 detection.cachesLocalStorage 配置），
 * 并触发所有 useTranslation 组件重渲染。
 */
export async function changeLanguage(lng: SupportedLanguage): Promise<void> {
  await i18next.changeLanguage(lng);
  syncHtmlLang(lng);
}
