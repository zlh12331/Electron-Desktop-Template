import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isAllowedRendererUrl, isHttpUrl, rendererEntryFileUrl } from './renderer-url';

const entryUrl = rendererEntryFileUrl(process.cwd());
const otherEntryUrl = rendererEntryFileUrl(join(process.cwd(), 'other-app'));

describe('isAllowedRendererUrl', () => {
  it('只接受产物入口 file URL 的完全匹配', () => {
    expect(isAllowedRendererUrl(entryUrl, entryUrl)).toBe(true);
    expect(isAllowedRendererUrl(otherEntryUrl, entryUrl)).toBe(false);
    expect(isAllowedRendererUrl(`${entryUrl}?spoof=1`, entryUrl)).toBe(false);
    expect(isAllowedRendererUrl(`${entryUrl}#spoof`, entryUrl)).toBe(false);
  });

  it('dev 只接受 dev server origin', () => {
    expect(
      isAllowedRendererUrl('http://localhost:5173/#/about', entryUrl, 'http://localhost:5173'),
    ).toBe(true);
    expect(
      isAllowedRendererUrl('http://localhost:5174/#/about', entryUrl, 'http://localhost:5173'),
    ).toBe(false);
    expect(isAllowedRendererUrl('file:///tmp/renderer/index.html', entryUrl)).toBe(false);
  });

  it('非法 URL 一律拒绝', () => {
    expect(isAllowedRendererUrl('not a url', entryUrl)).toBe(false);
    expect(isAllowedRendererUrl('https://example.com', entryUrl)).toBe(false);
  });
});

describe('isHttpUrl', () => {
  it('只接受 http/https，不接受前缀相似协议', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('https://example.com/a')).toBe(true);
    expect(isHttpUrl('httpfoo://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///tmp/a')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});
