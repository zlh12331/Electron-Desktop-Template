// scripts/acceptance-derived.ts
// 派生项目验收：在仓库外创建干净副本 → 全新安装 → 初始化/幂等 → 门禁 → E2E →
// 打包/smoke →（可选）NSIS 安装生命周期。用法见 docs/guides/template-acceptance.md。
// 不配置远端、不推送、不发 Release；失败默认保留副本便于排查。

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveExecutableName } from './init-template';
import { assertPortFree, cleanEnv, runPnpm } from './lib/acceptance/commands';
import { copyTrackedFiles, initGitRepository } from './lib/acceptance/copy';
import { runNsisLifecycle } from './lib/acceptance/nsis';
import {
  buildInitArgs,
  createAcceptanceBrand,
  installerFileName,
  platformBuildScript,
} from './lib/acceptance/plan';
import {
  appDataDir,
  deleteRegistryKey,
  protocolRegistryKey,
  registryKeyExists,
  updaterCacheDir,
} from './lib/acceptance/windows';
import { parseArgs, rejectPositionals } from './scaffold/lib/args';

/** 允许的 CLI flag */
const FLAGS = ['help', 'keep', 'skip-e2e', 'skip-build', 'nsis'] as const;
/** E2E dev server 固定端口（playwright.electron.config.ts） */
const E2E_PORT = 5173;

/** 读取 JSON 文件 */
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** 同步阶段计时 */
function stage<T>(name: string, fn: () => T): T {
  console.log(`\n▶ ${name}`);
  const started = Date.now();
  const result = fn();
  console.log(`✔ ${name}（${Date.now() - started}ms）`);
  return result;
}

/** 异步阶段计时 */
async function stageAsync(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n▶ ${name}`);
  const started = Date.now();
  await fn();
  console.log(`✔ ${name}（${Date.now() - started}ms）`);
}

/** 拒绝本命令未定义的 --key value（parseArgs 会把未知键收进 values） */
function assertNoUnexpectedValues(values: ReadonlyMap<string, string>): void {
  if (values.size > 0) {
    throw new Error(`未知参数：${[...values.keys()].map((key) => `--${key}`).join(', ')}`);
  }
}

/** 打印用法 */
function printHelp(): void {
  console.log(
    [
      '用法：pnpm acceptance:derived [--keep] [--skip-e2e] [--skip-build] [--nsis]',
      '',
      '  默认：全新安装 → 初始化/幂等 → 静态门禁 → E2E → 打包/smoke',
      '  --skip-e2e    跳过真实 Electron E2E（更快）',
      '  --skip-build  跳过打包、native-arch 与 smoke',
      '  --nsis        额外验证 NSIS 安装 → 启动 → 卸载（仅 Windows，隐含需要打包）',
      '  --keep        成功时也保留仓库外副本',
    ].join('\n'),
  );
}

/** 验收入口 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2), FLAGS);
  rejectPositionals(parsed);
  assertNoUnexpectedValues(parsed.values);
  if (parsed.flags.has('help')) {
    printHelp();
    return;
  }

  const keep = parsed.flags.has('keep');
  const skipE2E = parsed.flags.has('skip-e2e');
  const skipBuild = parsed.flags.has('skip-build');
  const nsis = parsed.flags.has('nsis');
  if (nsis && (skipBuild || process.platform !== 'win32')) {
    throw new Error('--nsis 需要 Windows 且不能同时使用 --skip-build');
  }

  const root = join(import.meta.dirname, '..');
  const brand = createAcceptanceBrand();
  const executableName = deriveExecutableName(brand.productName);
  const protocolKey = protocolRegistryKey(brand.protocol);
  if (process.platform === 'win32' && registryKeyExists(protocolKey)) {
    throw new Error(`测试协议已注册，拒绝覆盖：${protocolKey}`);
  }
  const appData = appDataDir(executableName);
  const appDataExisted = process.platform === 'win32' && existsSync(appData);
  const updaterCache = updaterCacheDir(executableName);
  const updaterCacheExisted = process.platform === 'win32' && existsSync(updaterCache);
  const copyRoot = mkdtempSync(join(tmpdir(), 'template-acceptance-'));
  let succeeded = false;

  try {
    console.log(`[acceptance] 品牌：${brand.productName}`);
    console.log(`[acceptance] 副本：${copyRoot}`);
    stage('复制 git 跟踪文件', () => {
      const count = copyTrackedFiles(root, copyRoot);
      // 仓库外副本不继承开发者全局 registry；.npmrc 固定官方源，镜像缺失 optional 平台包
      // manifest 时 minimumReleaseAge 会把全新安装判失败（2026-10-25 实测）
      if (existsSync(join(root, '.npmrc'))) {
        copyFileSync(join(root, '.npmrc'), join(copyRoot, '.npmrc'));
      }
      console.log(`  已复制 ${count} 个文件`);
      initGitRepository(copyRoot);
    });

    stage('全新安装依赖', () => {
      runPnpm(['install', '--frozen-lockfile'], copyRoot, { timeoutMs: 20 * 60_000 });
      const electronPathFile = join(copyRoot, 'node_modules/electron/path.txt');
      if (!existsSync(electronPathFile)) {
        throw new Error(
          'postinstall 未安装 Electron 二进制（node_modules/electron/path.txt 缺失）',
        );
      }
    });

    stage('初始化 dry-run（不落盘）', () => {
      const configPath = join(copyRoot, 'app.config.json');
      const before = readFileSync(configPath, 'utf8');
      const output = runPnpm(buildInitArgs(brand, true), copyRoot, { capture: true });
      if (!output.stdout.includes('将改动')) {
        throw new Error('dry-run 未报告将改动的文件');
      }
      if (readFileSync(configPath, 'utf8') !== before) {
        throw new Error('dry-run 落盘了 app.config.json');
      }
    });

    stage('初始化并校验幂等', () => {
      runPnpm(buildInitArgs(brand, false), copyRoot, { timeoutMs: 2 * 60_000 });
      const second = runPnpm(buildInitArgs(brand, false), copyRoot, { capture: true });
      if (!second.stdout.includes('无改动')) {
        throw new Error('第二次 init:template 仍有改动（幂等性失败）');
      }
    });

    stage('重链内部 workspace 包', () => {
      // scope 重写会改包名/依赖/锁文件；用 frozen 校验锁文件自洽，ignore-scripts 避免重复原生安装
      runPnpm(['install', '--frozen-lockfile', '--ignore-scripts'], copyRoot, {
        timeoutMs: 5 * 60_000,
      });
    });

    stage('品牌与 CSP 门禁', () => {
      runPnpm(['check:brand'], copyRoot, { timeoutMs: 2 * 60_000 });
      runPnpm(['check:csp-hash'], copyRoot, { timeoutMs: 2 * 60_000 });
    });

    stage('类型检查 / lint / 脚本测试', () => {
      runPnpm(['typecheck'], copyRoot, { timeoutMs: 5 * 60_000 });
      runPnpm(['lint'], copyRoot, { timeoutMs: 5 * 60_000 });
      runPnpm(['test:scripts'], copyRoot, { timeoutMs: 5 * 60_000 });
    });

    if (skipE2E) {
      console.log('\n- 跳过 E2E（--skip-e2e）');
    } else {
      await stageAsync('真实 Electron E2E（含跨重启持久化）', async () => {
        await assertPortFree(E2E_PORT);
        runPnpm(['test:e2e:electron', 'electron.spec.ts'], copyRoot, {
          env: cleanEnv(process.env),
          timeoutMs: 10 * 60_000,
        });
      });
    }

    if (skipBuild) {
      console.log('\n- 跳过打包 / smoke（--skip-build）');
    } else {
      stage('打包当前平台 + native-arch + smoke', () => {
        const script = platformBuildScript(process.platform, process.arch);
        runPnpm([script], copyRoot, { timeoutMs: 20 * 60_000 });
        runPnpm(['check:native-arch'], copyRoot, { timeoutMs: 2 * 60_000 });
        runPnpm(['test:smoke'], copyRoot, {
          env: cleanEnv(process.env),
          timeoutMs: 10 * 60_000,
        });
      });
    }

    if (nsis) {
      await stageAsync('NSIS 安装 → 启动 → 卸载', async () => {
        // 前面的 E2E/smoke 会注册测试协议并写 userData；NSIS 安装前先清理，确保从干净状态验证
        if (registryKeyExists(protocolKey)) {
          deleteRegistryKey(protocolKey);
        }
        if (!appDataExisted && existsSync(appData)) {
          rmSync(appData, { recursive: true, force: true });
        }
        if (!updaterCacheExisted && existsSync(updaterCache)) {
          rmSync(updaterCache, { recursive: true, force: true });
        }
        const derivedBrand = readJson<{
          productName: string;
          executableName: string;
          protocol: string;
          artifactBaseName: string;
        }>(join(copyRoot, 'app.config.json'));
        const version = readJson<{ version: string }>(join(copyRoot, 'package.json')).version;
        const installerPath = join(
          copyRoot,
          'release',
          installerFileName(derivedBrand.artifactBaseName, version, process.arch),
        );
        if (!existsSync(installerPath)) {
          throw new Error(`未找到 NSIS 安装包：${installerPath}`);
        }
        await runNsisLifecycle({
          installerPath,
          productName: derivedBrand.productName,
          executableName: derivedBrand.executableName,
          protocol: derivedBrand.protocol,
          workDir: join(copyRoot, 'nsis-lifecycle'),
          keep: true,
          confirmed: true,
        });
      });
    }

    succeeded = true;
    console.log('\n✅ 派生验收通过');
  } finally {
    if (process.platform === 'win32') {
      if (registryKeyExists(protocolKey)) {
        deleteRegistryKey(protocolKey);
      }
      if (!appDataExisted && existsSync(appData)) {
        rmSync(appData, { recursive: true, force: true });
      }
      if (!updaterCacheExisted && existsSync(updaterCache)) {
        rmSync(updaterCache, { recursive: true, force: true });
      }
    }
    if (succeeded && !keep) {
      rmSync(copyRoot, { recursive: true, force: true });
    } else {
      console.log(`\n验收副本保留：${copyRoot}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(`\n[acceptance] ❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
