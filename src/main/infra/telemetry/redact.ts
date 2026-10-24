// redact.ts：上行与诊断共用脱敏，保守截断不可信结构以免错误处理再次失败。
const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|passwd|credential|private[_-]?key|access[_-]?key|authorization|cookie)/i;

const VALUE_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
  {
    pattern: /\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi,
    replacement: '$1[REDACTED]@',
  },
  {
    pattern:
      /(\b[a-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd|credential|private[_-]?key|access[_-]?key)[a-z0-9_-]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s&#,;]+)/gi,
    replacement: '$1[REDACTED]',
  },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: 'sk-[REDACTED]' },
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, replacement: '$1[REDACTED]' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED PRIVATE KEY]' },
  { pattern: /\b[A-Fa-f0-9]{32,}\b/g, replacement: '[REDACTED]' },
];

/** 文本形态脱敏，不保证移除任意本地路径；原生 trace ID 应走专用结构。 */
export function redactText(text: string): string {
  let out = text;
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const MAX_DEPTH = 12;
const MAX_NODES = 2_048;
const MAX_ENTRIES = 128;

interface RedactionState {
  readonly seen: WeakSet<object>;
  remaining: number;
}

function redactChild(value: object, key: string, depth: number, state: RedactionState): unknown {
  // 不调用 getter，敏感容器连取值也不需要。
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor
      ? redactValue(descriptor.value, depth, state)
      : '[Unserializable]';
  } catch {
    return '[Unserializable]';
  }
}

function redactPrimitive(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }
  return typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
    ? '[Unsupported]'
    : value;
}

function redactValue(value: unknown, depth: number, state: RedactionState): unknown {
  if (state.remaining-- <= 0 || depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  if (value === null || typeof value !== 'object') {
    return redactPrimitive(value);
  }
  if (state.seen.has(value)) {
    return '[Circular]';
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const length = Math.min(value.length, MAX_ENTRIES, state.remaining);
      return Array.from({ length }, (_, index) =>
        redactChild(value, String(index), depth + 1, state),
      );
    }
    const result: Record<string, unknown> = {};
    for (const childKey of Object.keys(value).slice(0, MAX_ENTRIES)) {
      if (state.remaining <= 0) {
        break;
      }
      Object.defineProperty(result, childKey, {
        value: redactChild(value, childKey, depth + 1, state),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  } catch {
    return '[Unserializable]';
  } finally {
    state.seen.delete(value);
  }
}

/** 敏感键先整值替换，其余结构有界复制；不调用 getter、不保留原始对象引用。 */
export function redactSensitive(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  return redactValue(value, 0, { seen: new WeakSet(), remaining: MAX_NODES });
}
