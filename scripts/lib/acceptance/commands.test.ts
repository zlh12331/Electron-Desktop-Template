import { describe, expect, it } from 'vitest';

import { cleanEnv, resolvePnpmCommand } from './commands';

describe('resolvePnpmCommand', () => {
  it('npm_execpath 指向 pnpm 时直接复用（避免 Windows shell 引号问题）', () => {
    expect(resolvePnpmCommand('C:\\tools\\pnpm.exe', 'win32')).toBe('C:\\tools\\pnpm.exe');
    expect(resolvePnpmCommand('/usr/local/bin/pnpm', 'linux')).toBe('/usr/local/bin/pnpm');
  });

  it('npm_execpath 不是 pnpm 时回退平台默认命令', () => {
    expect(resolvePnpmCommand('C:\\npm\\npm.cmd', 'win32')).toBe('pnpm.exe');
    expect(resolvePnpmCommand('', 'linux')).toBe('pnpm');
  });
});

describe('cleanEnv', () => {
  it('删除指定键且不修改入参', () => {
    const source = {
      ['KEEP']: 'yes',
      ['ELECTRON_RUN_AS_NODE']: '1',
      ['APP_DEV_UPDATE']: '1',
    };
    const cleaned = cleanEnv(source, ['ELECTRON_RUN_AS_NODE', 'APP_DEV_UPDATE']);
    expect(cleaned).toEqual({ ['KEEP']: 'yes' });
    expect(source['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(source['APP_DEV_UPDATE']).toBe('1');
  });
});
