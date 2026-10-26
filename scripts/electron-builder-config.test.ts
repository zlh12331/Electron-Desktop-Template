// electron-builder-config.test.ts：打包配置的安全基线回归——fuses 与 asar 完整性是
// 构建期一次性烧入二进制的开关，被改回默认值时不会有任何运行时报错，必须在配置层断言。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

interface ElectronBuilderConfig {
  readonly asar?: boolean;
  readonly disableAsarIntegrity?: boolean;
  readonly electronFuses?: Readonly<Record<string, boolean>>;
}

const CONFIG_PATH = join(import.meta.dirname, '..', 'electron-builder.yml');

function readConfig(): ElectronBuilderConfig {
  return load(readFileSync(CONFIG_PATH, 'utf8')) as ElectronBuilderConfig;
}

describe('electron-builder.yml 安全基线', () => {
  it('fuses 关闭 Node 运行时复用、只从 asar 加载并启用完整性校验', () => {
    const fuses = readConfig().electronFuses;
    expect(fuses).toMatchObject({
      runAsNode: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
    });
  });

  it('打包态关闭外部 Node 选项，并保留 production smoke 所需的 inspect 参数', () => {
    const fuses = readConfig().electronFuses;
    expect(fuses?.['enableNodeOptionsEnvironmentVariable']).toBe(false);
    // Playwright _electron.launch 依赖 --inspect 驱动打包应用；关闭会让 6 平台 smoke 无法启动。
    expect(fuses?.['enableNodeCliInspectArguments']).toBe(true);
  });

  it('asar 开启且不关闭完整性校验', () => {
    const config = readConfig();
    expect(config.asar).toBe(true);
    expect(config.disableAsarIntegrity).toBe(false);
  });
});
