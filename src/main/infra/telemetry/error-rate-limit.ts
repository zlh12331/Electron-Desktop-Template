// error-rate-limit.ts：仅保留有界摘要计数，自动与手动错误共享上行预算。
import { createHash } from 'node:crypto';
import type { ErrorEvent } from '@sentry/electron/main';

const WINDOW_MS = 60_000;
const MAX_FINGERPRINTS = 128;
const PER_FINGERPRINT_LIMIT = 5;
const GLOBAL_LIMIT = 60;

interface WindowCounter {
  startedAt: number;
  count: number;
}

function fingerprint(event: ErrorEvent): string {
  const exception = event.exception?.values?.[0];
  const parts = [
    exception?.type,
    exception?.value ?? event.message ?? event.logentry?.message,
    ...(event.fingerprint?.slice(0, 8) ?? []),
    exception?.stacktrace?.frames?.at(-1)?.function,
  ];
  const digest = createHash('sha256');
  for (const part of parts) {
    const text = typeof part === 'string' ? part.slice(0, 2_048) : '';
    digest.update(`${text.length}:${text}`);
  }
  return digest.digest('hex');
}

/** 有界固定窗口错误预算；未处理和 fatal 证据不占用也不受配额限制。 */
export class ErrorEventRateLimiter {
  readonly #fingerprints = new Map<string, WindowCounter>();
  readonly #now: () => number;
  #global: WindowCounter = { startedAt: 0, count: 0 };

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  /** 仅暴露大小以验证高基数事件不会长期保留原始内容。 */
  get fingerprintCount(): number {
    return this.#fingerprints.size;
  }

  /** 返回是否放行；全局预算不能被轮换指纹绕开。 */
  tryAcquire(event: ErrorEvent): boolean {
    if (
      event.level === 'fatal' ||
      event.exception?.values?.some((value) => value.mechanism?.handled === false)
    ) {
      return true;
    }
    const now = this.#now();
    if (now - this.#global.startedAt >= WINDOW_MS || now < this.#global.startedAt) {
      this.#global = { startedAt: now, count: 0 };
    }
    if (this.#global.count >= GLOBAL_LIMIT) {
      return false;
    }
    const key = fingerprint(event);
    let counter = this.#fingerprints.get(key);
    if (counter === undefined || now - counter.startedAt >= WINDOW_MS || now < counter.startedAt) {
      counter = { startedAt: now, count: 0 };
      if (!this.#fingerprints.has(key) && this.#fingerprints.size >= MAX_FINGERPRINTS) {
        const oldest = this.#fingerprints.keys().next().value;
        if (oldest !== undefined) {
          this.#fingerprints.delete(oldest);
        }
      }
      this.#fingerprints.set(key, counter);
    }
    if (counter.count >= PER_FINGERPRINT_LIMIT) {
      return false;
    }
    counter.count += 1;
    this.#global.count += 1;
    return true;
  }
}
