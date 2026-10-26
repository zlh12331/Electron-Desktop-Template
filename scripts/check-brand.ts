// scripts/check-brand.ts
// 品牌一致性闸：app.config.json 是唯一真源，本脚本校验两类漂移——
// ① 生成物 packages/shared/src/constants/brand.ts 与真源不同步（忘了 brand:sync）；
// ② 无法 import 真源的位置（electron-builder.yml / package.json / dev-app-update.yml /
//    index.html / i18n 文案）里写死的旧品牌字面量与真源不一致。
// 运行：pnpm check:brand（CI 与 check:static 一并卡关）

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BRAND_OUTPUT,
  BRAND_SOURCE,
  readBrandSource,
  renderBrandModule,
} from './generate-brand.mjs';

/** 品牌真源形状（与 app.config.json 对齐；check 只读取这些字段） */
interface BrandSource {
  readonly productName: string;
  readonly appId: string;
  readonly executableName: string;
  readonly protocol: string;
  readonly storagePrefix: string;
  readonly author: string;
  readonly description: string;
  readonly artifactBaseName: string;
  readonly repo: { readonly owner: string; readonly name: string };
}

/** 仓库根 */
const ROOT = join(import.meta.dirname, '..');

/** 一处问题 */
export interface BrandIssue {
  readonly file: string;
  readonly detail: string;
}

/** 读文本（不存在返回 null，供可选文件用） */
function readIfExists(rel: string): string | null {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * 为一份文件内容创建断言函数
 *
 * @param issues 问题收集器
 * @param file 展示用文件路径
 * @param text 文件内容（null = 不存在）
 * @returns (needle, label) => void
 */
function expectContains(
  issues: BrandIssue[],
  file: string,
  text: string | null,
): (needle: string, label: string) => void {
  return (needle, label): void => {
    if (text === null) {
      issues.push({ file, detail: `文件不存在，无法校验 ${label}` });
      return;
    }
    if (!text.includes(needle)) {
      issues.push({
        file,
        detail: `${label} 应为 "${needle}"，实际未找到（真源 ${BRAND_SOURCE}）`,
      });
    }
  };
}

/** 校验 electron-builder.yml 的 appId / productName / 协议 / 可执行名 / artifactName 前缀 */
function checkElectronBuilder(issues: BrandIssue[], brand: BrandSource): void {
  const file = 'electron-builder.yml';
  const text = readIfExists(file);
  const expectInFile = expectContains(issues, file, text);
  expectInFile(`appId: ${brand.appId}`, 'appId');
  expectInFile(`productName: ${brand.productName}`, 'productName');
  expectInFile(`executableName: ${brand.executableName}`, 'executableName');
  expectInFile(`name: ${brand.protocol}`, 'protocols.name');
  expectInFile(`schemes:\n        - ${brand.protocol}`, 'protocols.schemes');
  expectInFile(`synopsis: ${brand.productName}`, 'linux.synopsis');
  expectInFile(`description: ${brand.description}`, 'linux.description');
  expectInFile(`artifactName: ${brand.artifactBaseName}-Windows-`, 'nsis.artifactName');
  expectInFile(`artifactName: ${brand.artifactBaseName}-macOS-`, 'mac.artifactName');
  expectInFile(`artifactName: ${brand.artifactBaseName}-Linux-`, 'linux.artifactName');
}

/** 校验 package.json 的 name / description / author / repository */
function checkPackageJson(issues: BrandIssue[], brand: BrandSource): void {
  const raw = readIfExists('package.json');
  if (raw === null) {
    issues.push({ file: 'package.json', detail: '文件不存在' });
    return;
  }
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  if (pkg['name'] !== brand.executableName) {
    issues.push({
      file: 'package.json',
      detail: `name 应为 "${brand.executableName}"，实际 "${String(pkg['name'])}"`,
    });
  }
  if (pkg['description'] !== brand.description) {
    issues.push({
      file: 'package.json',
      detail: `description 应为 "${brand.description}"，实际 "${String(pkg['description'])}"`,
    });
  }
  if (pkg['author'] !== brand.author) {
    issues.push({
      file: 'package.json',
      detail: `author 应为 "${brand.author}"，实际 "${String(pkg['author'])}"`,
    });
  }
  // repository 是 electron-builder 解析 GitHub provider 的兜底来源之一；缺失会让打包产物
  // 不生成 app-update.yml（自动更新在打包版直接失效，且构建日志无报错）
  const repository = pkg['repository'] as { url?: unknown } | undefined;
  const expectedUrl = `https://github.com/${brand.repo.owner}/${brand.repo.name}.git`;
  if (repository?.url !== expectedUrl) {
    issues.push({
      file: 'package.json',
      detail: `repository.url 应为 "${expectedUrl}"，实际 "${String(repository?.url)}"`,
    });
  }
}

/** 校验 index.html 标题与首帧主题脚本里的存储键 */
function checkIndexHtml(issues: BrandIssue[], brand: BrandSource): void {
  const file = 'src/renderer/index.html';
  const text = readIfExists(file);
  const expectInFile = expectContains(issues, file, text);
  expectInFile(`<title>${brand.productName}</title>`, 'title');
  expectInFile(`localStorage.getItem('${brand.storagePrefix}:theme')`, '首帧主题存储键');
}

/** 校验 dev-app-update.yml 的仓库坐标 */
function checkDevAppUpdate(issues: BrandIssue[], brand: BrandSource): void {
  const file = 'dev-app-update.yml';
  const text = readIfExists(file);
  const expectInFile = expectContains(issues, file, text);
  expectInFile(`owner: ${brand.repo.owner}`, 'repo.owner');
  expectInFile(`repo: ${brand.repo.name}`, 'repo.name');
}

/** 校验 NSIS 安装宏里的 Windows 协议（electron-builder 的 protocols 仅 macOS） */
function checkInstallerProtocol(issues: BrandIssue[], brand: BrandSource): void {
  const file = 'resources/installer.nsh';
  const text = readIfExists(file);
  const expectInFile = expectContains(issues, file, text);
  expectInFile(`!define APP_PROTOCOL "${brand.protocol}"`, 'NSIS 协议');
}

/**
 * 校验保留的模板营销站与品牌真源一致
 *
 * 站点是可选资产：派生项目默认在 init:template 时移除；使用 --keep-site 时
 * 必须同步产品名、品牌名与仓库 URL，防止把上游链接发布到派生项目的 Pages。
 */
function checkSite(issues: BrandIssue[], brand: BrandSource): void {
  const file = 'site/electron-desktop-template-website.html';
  const text = readIfExists(file);
  const expectInFile = expectContains(issues, file, text);
  if (text === null) {
    return;
  }
  expectInFile(`<title>${brand.productName}`, 'site title');
  expectInFile(`<span class="brand-name">${brand.productName}</span>`, 'site brand-name');
  expectInFile(`https://github.com/${brand.repo.owner}/${brand.repo.name}`, 'site repo URL');
}

/**
 * 校验运行时脚本与 GitHub 自动化里没有写死本仓库坐标与产物名
 *
 * workflow 与 CI 脚本通过「Use this template」/ fork 分发后不再改写；任何写死的
 * `owner/repo` 都会让派生项目去操作上游仓库（issue-metrics 会静默统计错仓库），
 * 写死的产物名前缀则让资产断言在派生项目首次发布时全部失败。
 * 两者都必须走运行时上下文（`${{ github.repository }}` / GITHUB_REPOSITORY /
 * app.config.json），本检查防止回潮。
 */
function checkRuntimeCoords(issues: BrandIssue[], brand: BrandSource): void {
  const repoSlug = `${brand.repo.owner}/${brand.repo.name}`;
  for (const file of collectRuntimeFiles()) {
    const text = readIfExists(file);
    if (text === null) {
      continue;
    }
    if (text.includes(repoSlug)) {
      issues.push({
        file,
        detail: `写死了仓库坐标 "${repoSlug}"；改用 \${{ github.repository }} / GITHUB_REPOSITORY / resolveRepoSlug()`,
      });
    }
    if (text.includes(brand.artifactBaseName)) {
      issues.push({
        file,
        detail: `写死了产物前缀 "${brand.artifactBaseName}"；改从 ${BRAND_SOURCE} 读取`,
      });
    }
  }
}

/** 递归收集脚本目录下的非测试 TS 文件（相对仓库根，统一使用 /） */
function collectScriptFiles(root: string, relativeDir: string): string[] {
  const abs = join(root, relativeDir);
  if (!existsSync(abs)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectScriptFiles(root, relativePath));
    } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

/**
 * 需要扫描的运行时文件（workflow + 非测试脚本；测试里的固定桩不受品牌真源约束）
 *
 * @param root 仓库根（测试可注入临时目录）
 * @returns 仓库相对路径列表
 */
export function collectRuntimeFiles(root: string = ROOT): string[] {
  const files: string[] = [];
  const workflows = join(root, '.github', 'workflows');
  if (existsSync(workflows)) {
    for (const name of readdirSync(workflows)) {
      if (/\.ya?ml$/.test(name)) {
        files.push(`.github/workflows/${name}`);
      }
    }
  }
  files.push(...collectScriptFiles(root, 'scripts'));
  return files;
}

/** 主流程 */
function main(): void {
  const brand = readBrandSource() as BrandSource;
  const issues: BrandIssue[] = [];

  const expected = renderBrandModule(brand);
  const actual = readIfExists(BRAND_OUTPUT);
  if (actual !== expected) {
    issues.push({
      file: BRAND_OUTPUT,
      detail: `生成物与 ${BRAND_SOURCE} 不同步，执行 pnpm brand:sync 重新生成`,
    });
  }

  checkElectronBuilder(issues, brand);
  checkPackageJson(issues, brand);
  checkIndexHtml(issues, brand);
  checkDevAppUpdate(issues, brand);
  checkInstallerProtocol(issues, brand);
  checkSite(issues, brand);
  checkRuntimeCoords(issues, brand);
  if (issues.length === 0) {
    console.log(`[check-brand] ✅ 品牌一致（${BRAND_SOURCE}）`);
    return;
  }

  console.error(`[check-brand] ❌ 发现 ${issues.length} 处品牌漂移（真源 ${BRAND_SOURCE}）：`);
  for (const issue of issues) {
    console.error(`  - ${issue.file}: ${issue.detail}`);
  }
  process.exit(1);
}

main();
