import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { applyCspToSession, buildCsp } from './csp';

type HeaderDetails = { readonly url: string; readonly responseHeaders?: Record<string, string[]> };
type HeaderCallback = (response: { responseHeaders?: Record<string, string[]> }) => void;

function fakeSession(): {
  session: Session;
  emit: (details: HeaderDetails) => { responseHeaders?: Record<string, string[]> };
} {
  let listener: ((details: HeaderDetails, callback: HeaderCallback) => void) | null = null;
  const session = {
    webRequest: {
      onHeadersReceived: (callback: (details: HeaderDetails, cb: HeaderCallback) => void) => {
        listener = callback;
      },
    },
  } as unknown as Session;
  return {
    session,
    emit: (details) => {
      const callback = vi.fn<HeaderCallback>();
      if (listener === null) {
        throw new Error('onHeadersReceived 未注册');
      }
      listener(details, callback);
      return callback.mock.calls[0]?.[0] ?? {};
    },
  };
}

describe('buildCsp', () => {
  it('生产环境：严格策略（script-src 无 unsafe-inline）', () => {
    const csp = buildCsp(false);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain('wasm-unsafe-eval');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('api.deepseek.com');
    expect(csp).not.toContain('api.openai.com');
    expect(csp).not.toContain('api.anthropic.com');
    expect(csp).not.toContain('http://localhost:11434');
    expect(csp).not.toContain('http://localhost:*');
  });

  it('开发环境：允许 HMR（unsafe-inline script + localhost ws/http）', () => {
    const csp = buildCsp(true);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain('wasm-unsafe-eval');
    expect(csp).toContain('ws://localhost:*');
    expect(csp).toContain('http://localhost:*');
    expect(csp).toContain("frame-ancestors 'self' chrome-extension:");
  });

  it('生产 CSP 不含 worker 限制缺失（worker-src 存在）', () => {
    const csp = buildCsp(false);
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it('指令以分号连接且 default-src 为首', () => {
    const csp = buildCsp(false);
    const directives = csp.split('; ');
    expect(directives[0]).toBe("default-src 'self'");
    expect(directives.length).toBeGreaterThan(8);
  });
});

describe('applyCspToSession', () => {
  it('生产 file 响应：注入 CSP/nosniff，不注入 XFO', () => {
    const { session, emit } = fakeSession();
    applyCspToSession(session, false);
    const result = emit({
      url: 'file:///app/renderer/index.html',
      responseHeaders: { 'X-Existing': ['1'] },
    });
    expect(result.responseHeaders?.['Content-Security-Policy']).toEqual([buildCsp(false)]);
    expect(result.responseHeaders?.['X-Content-Type-Options']).toEqual(['nosniff']);
    expect(result.responseHeaders?.['X-Frame-Options']).toBeUndefined();
    expect(result.responseHeaders?.['X-Existing']).toEqual(['1']);
  });

  it('生产 http 响应：额外注入 X-Frame-Options DENY', () => {
    const { session, emit } = fakeSession();
    applyCspToSession(session, false);
    const result = emit({ url: 'https://example.com/page' });
    expect(result.responseHeaders?.['X-Frame-Options']).toEqual(['DENY']);
  });

  it('开发 http 响应：X-Frame-Options SAMEORIGIN', () => {
    const { session, emit } = fakeSession();
    applyCspToSession(session, true);
    const result = emit({ url: 'http://localhost:5173/' });
    expect(result.responseHeaders?.['X-Frame-Options']).toEqual(['SAMEORIGIN']);
    expect(result.responseHeaders?.['Content-Security-Policy']).toEqual([buildCsp(true)]);
  });

  it('chrome-extension 响应：完全跳过，不覆盖扩展自身响应头', () => {
    const { session, emit } = fakeSession();
    applyCspToSession(session, false);
    const result = emit({
      url: 'chrome-extension://abc/content.js',
      responseHeaders: { 'X-Extension': ['1'] },
    });
    expect(result).toEqual({});
  });
});
