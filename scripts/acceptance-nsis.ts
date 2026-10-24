// scripts/acceptance-nsis.ts
// 独立 NSIS 安装生命周期验证：需要已构建的 installer，显式 --yes 才会安装/卸载。
// Windows-only；建议在一次性 VM 或测试账号中运行。失败默认保留现场。

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNsisLifecycle } from './lib/acceptance/nsis';
import { assertNoWhitespace } from './lib/acceptance/nsis-plan';
import { parseArgs, rejectPositionals } from './scaffold/lib/args';

/** 允许的 flag */
const FLAGS = ['help', 'yes', 'keep'] as const;
/** 允许的 --key value */
const VALUE_KEYS = ['installer', 'work-dir'] as const;

/** 打印用法 */
function printHelp(): void {
  console.log(
    [
      '用法：pnpm acceptance:nsis --installer <path-to.exe> --yes [--keep] [--work-dir <dir>]',
      '',
      '  --installer  已构建的 NSIS 安装包（.exe）',
      '  --yes        确认执行安装/卸载（会写 HKCU 与 %APPDATA%）',
      '  --keep       成功后也保留安装目录',
      '  --work-dir   隔离工作目录（不能含空白；缺省使用系统临时目录）',
    ].join('\n'),
  );
}

/** 读取当前仓库品牌真源 */
function readBrand(): { productName: string; executableName: string; protocol: string } {
  const raw = JSON.parse(readFileSync(join(process.cwd(), 'app.config.json'), 'utf8')) as {
    productName?: unknown;
    executableName?: unknown;
    protocol?: unknown;
  };
  if (
    typeof raw.productName !== 'string' ||
    typeof raw.executableName !== 'string' ||
    typeof raw.protocol !== 'string'
  ) {
    throw new Error('app.config.json 缺少 productName / executableName / protocol');
  }
  return {
    productName: raw.productName,
    executableName: raw.executableName,
    protocol: raw.protocol,
  };
}

/** 校验没有未知的 --key value */
function assertKnownValues(values: ReadonlyMap<string, string>): void {
  const allowed = new Set<string>(VALUE_KEYS);
  for (const key of values.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`未知参数 --${key}（支持：${VALUE_KEYS.map((k) => `--${k}`).join(' / ')}）`);
    }
  }
}

/** 入口 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2), FLAGS);
  rejectPositionals(parsed);
  assertKnownValues(parsed.values);
  if (parsed.flags.has('help')) {
    printHelp();
    return;
  }
  if (process.platform !== 'win32') {
    console.log('[acceptance:nsis] 跳过：NSIS 安装生命周期仅支持 Windows');
    return;
  }

  const installerArg = parsed.values.get('installer');
  if (installerArg === undefined) {
    throw new Error('缺少必填参数 --installer <path-to.exe>');
  }
  if (!parsed.flags.has('yes')) {
    console.log('[acceptance:nsis] 未执行。该命令会真实安装并卸载应用；确认后追加 --yes。');
    process.exitCode = 1;
    return;
  }

  const brand = readBrand();
  const workDir = parsed.values.get('work-dir') ?? mkdtempSync(join(tmpdir(), 'nsis-lifecycle-'));
  assertNoWhitespace(workDir, '工作目录');
  const installerPath = resolve(installerArg);
  console.log(`[acceptance:nsis] installer=${installerPath}`);
  console.log(`[acceptance:nsis] workDir=${workDir}`);

  await runNsisLifecycle({
    installerPath,
    productName: brand.productName,
    executableName: brand.executableName,
    protocol: brand.protocol,
    workDir,
    keep: parsed.flags.has('keep'),
    confirmed: true,
  });
}

main().catch((error: unknown) => {
  console.error(`\n[acceptance:nsis] ❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
