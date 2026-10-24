import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COVERAGE_SCOPES,
  collectSourceFiles,
  findScopeGaps,
  isAllowed,
  parseLcovSourceFiles,
} from './coverage-scope';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('isAllowed', () => {
  it('精确路径与前缀目录都识别', () => {
    expect(isAllowed('index.ts', ['index.ts'])).toBe(true);
    expect(isAllowed('routes/home.tsx', ['routes/**'])).toBe(true);
    expect(isAllowed('routes-home.tsx', ['routes/**'])).toBe(false);
  });
});

describe('collectSourceFiles', () => {
  it('跳过测试/配置/声明/生成目录', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'scope-'));
    mkdirSync(join(tempDir, 'sub'), { recursive: true });
    mkdirSync(join(tempDir, 'coverage'), { recursive: true });
    writeFileSync(join(tempDir, 'keep.ts'), '');
    writeFileSync(join(tempDir, 'sub', 'also.tsx'), '');
    writeFileSync(join(tempDir, 'skip.test.ts'), '');
    writeFileSync(join(tempDir, 'skip.config.ts'), '');
    writeFileSync(join(tempDir, 'types.d.ts'), '');
    writeFileSync(join(tempDir, 'coverage', 'generated.ts'), '');

    expect(collectSourceFiles(tempDir)).toEqual(['keep.ts', 'sub/also.tsx']);
  });
});

describe('findScopeGaps', () => {
  it('未进入 lcov 且不在排除清单的文件计为缺口', () => {
    const scope = COVERAGE_SCOPES[0];
    if (scope === undefined) throw new Error('缺少 main scope');
    expect(
      findScopeGaps(scope, ['index.ts', 'deep-link.ts', 'window.ts'], ['deep-link.ts']),
    ).toEqual(['window.ts']);
  });

  it('shared 的 lcov src/ 前缀会被剥离', () => {
    const scope = COVERAGE_SCOPES.find((item) => item.layer === 'shared');
    if (scope === undefined) throw new Error('缺少 shared scope');
    expect(findScopeGaps(scope, ['index.ts', 'constants/errors.ts'], ['src/constants/errors.ts'])).toEqual(
      [],
    );
  });
});

describe('parseLcovSourceFiles', () => {
  it('只取 SF 并归一化 Windows 分隔符', () => {
    expect(parseLcovSourceFiles('SF:a\\b.ts\nDA:1,1\nSF:c/d.tsx\n')).toEqual(['a/b.ts', 'c/d.tsx']);
  });
});
