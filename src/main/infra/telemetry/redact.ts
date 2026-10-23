// redact.ts：诊断导出与遥测上报共用的脱敏规则（键名形态 + 值形态双层）
// 边界：只做字符串/结构变换，不读取文件、不依赖 Electron——诊断包、Sentry beforeSend、
// OTel 日志属性共用同一套规则，避免三处各写一份导致漏脱敏

/** 键名形态兜底：键名命中即整体 [REDACTED]（不看值） */
const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|passwd|credential|private[_-]?key|access[_-]?key)/i;

// 值形态兜底：键名不含敏感词但值本身是密钥形态（日志正文里的 key 串、Bearer 头、PEM 头、32+ 位 hex）
const VALUE_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: 'sk-[REDACTED]' },
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, replacement: '$1[REDACTED]' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED PRIVATE KEY]' },
  {
    pattern: /\b[A-Fa-f0-9]{32,}\b/g,
    replacement: '[REDACTED]',
  },
];

/**
 * 对任意文本跑值形态脱敏
 *
 * 日志行没有键名上下文，只能按形态匹配；这是诊断包与遥测导出前的最后一道防线，
 * 不替代调用方不打印凭据的义务。
 *
 * @param text 原始文本
 * @returns 脱敏后的文本
 */
export function redactText(text: string): string {
  let out = text;
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 递归脱敏任意结构：对象/数组深入遍历，键名命中即整值 [REDACTED]，
 * 字符串叶子再过一遍值形态（双层：键名层 + 值形态层）
 *
 * @param value 任意可序列化结构
 * @param key 当前层级的键名（递归内部使用）
 * @returns 脱敏后的新结构（不修改入参）
 */
export function redactSensitive(value: unknown, key = ''): unknown {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((item) => redactSensitive(item, key));
    }
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = redactSensitive(childValue, childKey);
    }
    return result;
  }
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  return typeof value === 'string' ? redactText(value) : value;
}
