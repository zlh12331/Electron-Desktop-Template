import { describe, expect, it } from 'vitest';

import {
  buildInitArgs,
  createAcceptanceBrand,
  installerFileName,
  platformBuildScript,
} from './plan';

describe('createAcceptanceBrand', () => {
  it('使用固定产品身份，协议带可读前缀与唯一后缀', () => {
    const brand = createAcceptanceBrand(new Date(1_700_000_000_000));
    expect(brand.productName).toBe('Derived Acceptance Lab');
    expect(brand.appId).toBe('com.example.derived-acceptance');
    expect(brand.protocol).toMatch(/^derived-acceptance-[a-z0-9]+$/);
    expect(brand.owner).toBe('template-acceptance');
    expect(brand.repo).toBe('derived-acceptance');
    expect(brand.scope).toBe('derived-acceptance');
  });

  it('不同时间生成不同协议（避免重复验收撞注册表）', () => {
    const first = createAcceptanceBrand(new Date(1_700_000_000_000));
    const second = createAcceptanceBrand(new Date(1_700_000_001_000));
    expect(first.protocol).not.toBe(second.protocol);
  });
});

describe('buildInitArgs', () => {
  it('包含全部品牌参数，dry-run 是最后一个 flag', () => {
    const brand = createAcceptanceBrand(new Date(1_700_000_000_000));
    const args = buildInitArgs(brand, true);
    expect(args[0]).toBe('init:template');
    expect(args).toContain(brand.productName);
    expect(args).toContain(brand.appId);
    expect(args).toContain(brand.protocol);
    expect(args).toContain(brand.scope);
    expect(args.at(-1)).toBe('--dry-run');
  });

  it('正式执行不携带 --dry-run', () => {
    const args = buildInitArgs(createAcceptanceBrand(), false);
    expect(args).not.toContain('--dry-run');
  });
});

describe('platformBuildScript', () => {
  it('按平台与架构映射现有打包脚本', () => {
    expect(platformBuildScript('win32', 'x64')).toBe('build:win:x64');
    expect(platformBuildScript('win32', 'arm64')).toBe('build:win:arm64');
    expect(platformBuildScript('darwin', 'arm64')).toBe('build:mac:arm64');
    expect(platformBuildScript('linux', 'x64')).toBe('build:linux:x64');
  });

  it('拒绝不支持的架构与平台', () => {
    expect(() => platformBuildScript('win32', 'ia32')).toThrow(/不支持的架构/);
    expect(() => platformBuildScript('freebsd', 'x64')).toThrow(/不支持的平台/);
  });
});

describe('installerFileName', () => {
  it('与 electron-builder 的 artifactName 同构', () => {
    expect(installerFileName('Derived-Acceptance-Lab', '0.0.0', 'x64')).toBe(
      'Derived-Acceptance-Lab-Windows-x64-0.0.0.exe',
    );
  });
});
