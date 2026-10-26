// theme-default-sync.test.ts：首帧主题兜底与 DEFAULT_THEME_SETTING 的同步守卫。
// index.html 的内联脚本必须先于应用 JS 执行，无法 import 共享常量；这里断言两处字面量一致，
// 防止“改了默认主题但首帧仍闪旧主题”。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const DEFAULTS_FILE = 'packages/shared/src/constants/settings-defaults.ts';
const INDEX_HTML = 'src/renderer/index.html';

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('首帧主题默认值', () => {
  it('index.html 的兜底主题与 DEFAULT_THEME_SETTING 一致', () => {
    const defaults = /DEFAULT_THEME_SETTING\s*=\s*'([^']+)'/.exec(read(DEFAULTS_FILE))?.[1];
    const fallback = /t!=='light'&&t!=='dark'&&t!=='system'\)\{t='([^']+)'\}/.exec(
      read(INDEX_HTML),
    )?.[1];
    expect(defaults).toBeDefined();
    expect(fallback).toBe(defaults);
  });
});
