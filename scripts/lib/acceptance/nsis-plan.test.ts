import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertNoWhitespace,
  installedExePath,
  nsisInstallArgs,
  uninstallerPath,
  validateInstallerPath,
} from './nsis-plan';

describe('nsisInstallArgs', () => {
  it('静默安装，/D 必须是最后一个参数', () => {
    const args = nsisInstallArgs('C:\\temp\\nsis\\install');
    expect(args).toEqual(['/S', '/D=C:\\temp\\nsis\\install']);
    expect(args.at(-1)).toMatch(/^\/D=/);
  });

  it('拒绝含空白的安装目录', () => {
    expect(() => nsisInstallArgs('C:\\temp\\nsis lab\\install')).toThrow(/空白/);
  });
});

describe('路径推导', () => {
  it('已安装 exe 与卸载器使用产品名', () => {
    expect(installedExePath('C:\\app', 'Derived Acceptance Lab')).toBe(
      'C:\\app\\Derived Acceptance Lab.exe',
    );
    expect(uninstallerPath('C:\\app', 'Derived Acceptance Lab')).toBe(
      'C:\\app\\Uninstall Derived Acceptance Lab.exe',
    );
  });

  it('assertNoWhitespace 报出字段名', () => {
    expect(() => assertNoWhitespace('C:\\work dir', '工作目录')).toThrow(/工作目录/);
  });
});

describe('validateInstallerPath', () => {
  let dir: string;

  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('接受存在的 .exe', () => {
    dir = mkdtempSync(join(tmpdir(), 'nsis-plan-'));
    const installer = join(dir, 'setup.exe');
    writeFileSync(installer, '');
    expect(() => validateInstallerPath(installer)).not.toThrow();
  });

  it('拒绝非 .exe 与不存在的文件', () => {
    dir = mkdtempSync(join(tmpdir(), 'nsis-plan-'));
    expect(() => validateInstallerPath(join(dir, 'setup.msi'))).toThrow(/\.exe/);
    expect(() => validateInstallerPath(join(dir, 'missing.exe'))).toThrow(/不存在/);
  });
});
