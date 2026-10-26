// check-brand.test.ts：品牌坐标扫描范围回归——scripts/ 子目录曾被顶层 readdir 漏掉。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectRuntimeFiles } from './check-brand';

describe('collectRuntimeFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brand-scan-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('递归扫描 scripts 子目录，排除测试文件', () => {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, 'scripts', 'lib', 'deep'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), '');
    writeFileSync(join(root, '.github', 'workflows', 'release.yaml'), '');
    writeFileSync(join(root, 'scripts', 'top.ts'), '');
    writeFileSync(join(root, 'scripts', 'lib', 'deep', 'nested.ts'), '');
    writeFileSync(join(root, 'scripts', 'lib', 'deep', 'nested.test.ts'), '');

    const files = collectRuntimeFiles(root);

    expect(files).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml',
        '.github/workflows/release.yaml',
        'scripts/top.ts',
        'scripts/lib/deep/nested.ts',
      ]),
    );
    expect(files).not.toContain('scripts/lib/deep/nested.test.ts');
  });
});
