// observability-config-check.ts：配置注册表与代码/模板/文档/CI 的一致性纯逻辑
// 边界：只做文本解析与集合比对；文件遍历在 scripts/check-observability-config.ts
import type { ObservabilityEnvEntry } from '@code-agent/shared/observability';

/** 可观测性变量前缀（只检查这两类，避免误伤 APP_* 等开发开关） */
const OBSERVABILITY_PREFIX = /^(?:SENTRY|OTEL)_/;

/** 匹配 process.env['KEY'] / env['KEY'] 两种常见读取形态 */
const ENV_ACCESS_PATTERN = /(?:process\.env|env)\s*\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g;

/** 从任意文本提取 SENTRY_ 或 OTEL_ 前缀的访问键（去重） */
export function extractObservabilityEnvKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const match of text.matchAll(ENV_ACCESS_PATTERN)) {
    const key = match[1];
    if (key !== undefined && OBSERVABILITY_PREFIX.test(key)) {
      keys.add(key);
    }
  }
  return keys;
}

/** 从 .env.example / workflow env 文本提取键（支持注释行） */
export function extractDeclaredEnvKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    const key = match?.[1];
    if (key !== undefined && OBSERVABILITY_PREFIX.test(key)) {
      keys.add(key);
    }
  }
  return keys;
}

/** 注册表自身校验：重复键、空描述、非法默认值形态 */
export function validateRegistry(entries: readonly ObservabilityEnvEntry[]): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      problems.push(`注册表重复键：${entry.key}`);
    }
    seen.add(entry.key);
    if (!/^[A-Z][A-Z0-9_]*$/.test(entry.key)) {
      problems.push(`键名不合规：${entry.key}`);
    }
    if (entry.scopes.length === 0) {
      problems.push(`${entry.key} 缺少作用域`);
    }
    if (entry.description.trim() === '') {
      problems.push(`${entry.key} 缺少描述`);
    }
    if (entry.consumers.length === 0) {
      problems.push(`${entry.key} 缺少消费方`);
    }
  }
  return problems;
}

/** 注册表键是否全部出现在某段文本中 */
export function findMissingKeys(
  entries: readonly ObservabilityEnvEntry[],
  text: string,
  label: string,
): readonly string[] {
  return entries
    .filter((entry) => !text.includes(entry.key))
    .map((entry) => `${label} 缺少 ${entry.key}`);
}

/** 找出代码/CI 里引用但注册表未声明的键 */
export function findUnknownKeys(
  entries: readonly ObservabilityEnvEntry[],
  references: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] {
  const known = new Set(entries.map((entry) => entry.key));
  const problems: string[] = [];
  for (const [file, keys] of references) {
    for (const key of keys) {
      if (!known.has(key)) {
        problems.push(`${file} 引用了未注册变量 ${key}`);
      }
    }
  }
  return problems;
}
