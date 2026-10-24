// scripts/init-template.ts
// 模板初始化：把本仓库从「上游模板」改造成使用者的新项目。
// 为什么需要：品牌真源 app.config.json 只管运行时与构建产物，仓库里还有一批
// 无法 import 的位置（package.json / LICENSE / CODEOWNERS / 文档 URL / i18n 文案），
// 手工改 8 类位点必然漏；漏掉的位点在 check:brand 之外，CI 也不会报。
// 用法：pnpm init:template --name "My App" --app-id com.me.myapp --protocol myapp \
//         --owner me --repo myapp [--author "Me"] [--description "..."] \
//         [--artifact-base My-App] [--executable my-app] [--dry-run]
// 幂等：重复执行同一组参数不产生额外改动（每步都是「替换已知旧值」或「写定值」）。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderBrandModule } from './generate-brand.mjs';
import { type ParsedArgs, parseArgs, rejectPositionals, requireValue } from './scaffold/lib/args';

/** 仓库根 */
const REPO_ROOT = join(import.meta.dirname, '..');

/** 品牌真源（相对 root） */
export const BRAND_SOURCE = 'app.config.json';

/** 品牌生成物（相对 root） */
export const BRAND_OUTPUT = 'packages/shared/src/constants/brand.ts';

/** 初始化输入（全部经校验后使用） */
export interface InitInput {
  readonly productName: string;
  readonly appId: string;
  readonly protocol: string;
  readonly storagePrefix: string;
  readonly executableName: string;
  readonly artifactBaseName: string;
  readonly owner: string;
  readonly repo: string;
  readonly author: string;
  readonly description: string;
}

/** 一处改写结果 */
export interface RewriteResult {
  readonly file: string;
  readonly changed: boolean;
}

/** app.config.json 的完整形状（init 需要读写全部字段） */
interface BrandConfig {
  productName: string;
  appId: string;
  executableName: string;
  protocol: string;
  storagePrefix: string;
  author: string;
  description: string;
  artifactBaseName: string;
  repo: { owner: string; name: string };
  [key: string]: unknown;
}

/** appId 形如 com.example.app（至少两段，小写字母数字与连字符） */
const APP_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;

/** 协议 scheme：小写字母开头，允许字母数字 + - . */
const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*$/;

/** GitHub 用户名/组织名：字母数字与连字符，不能以连字符开头结尾 */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** 仓库名：字母数字与 . _ - */
const REPO_RE = /^[A-Za-z0-9._-]+$/;

/**
 * 由 productName 推导可执行名（小写 + 连字符）
 *
 * `My App` → `my-app`；连续非字母数字折叠为单个连字符并去首尾。
 */
export function deriveExecutableName(productName: string): string {
  return productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 由可执行名推导安装包前缀（Title-Case-With-Dashes） */
export function deriveArtifactBaseName(executableName: string): string {
  return executableName
    .split('-')
    .filter((seg) => seg.length > 0)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('-');
}

/**
 * 校验并补全初始化输入
 *
 * @throws Error 当任一字段格式非法
 */
export function buildInitInput(raw: {
  productName: string;
  appId: string;
  protocol: string;
  owner: string;
  repo: string;
  author?: string;
  description?: string;
  executableName?: string;
  artifactBaseName?: string;
}): InitInput {
  const productName = raw.productName.trim();
  if (productName.length === 0) {
    throw new Error('--name 不能为空');
  }
  if (!APP_ID_RE.test(raw.appId)) {
    throw new Error(`--app-id 格式非法：${raw.appId}（应形如 com.example.myapp）`);
  }
  if (!PROTOCOL_RE.test(raw.protocol)) {
    throw new Error(`--protocol 格式非法：${raw.protocol}（小写字母开头，可含数字 + - .）`);
  }
  if (!OWNER_RE.test(raw.owner)) {
    throw new Error(`--owner 格式非法：${raw.owner}（GitHub 用户名/组织名）`);
  }
  if (!REPO_RE.test(raw.repo)) {
    throw new Error(`--repo 格式非法：${raw.repo}（仓库名）`);
  }

  const executableName = raw.executableName ?? deriveExecutableName(productName);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(executableName)) {
    // 中文等非 ASCII 产品名推导结果为空：必须引导用户显式给可执行名，而不是只报格式错误
    if (raw.executableName === undefined) {
      throw new Error(
        `产品名「${productName}」无法推导可执行名（需小写字母数字与连字符）。请显式传 --executable，例如 --executable my-app`,
      );
    }
    throw new Error(`--executable 格式非法：${executableName}（需小写字母数字与连字符）`);
  }
  const artifactBaseName = raw.artifactBaseName ?? deriveArtifactBaseName(executableName);

  return {
    productName,
    appId: raw.appId,
    protocol: raw.protocol,
    storagePrefix: executableName,
    executableName,
    artifactBaseName,
    owner: raw.owner,
    repo: raw.repo,
    author: raw.author?.trim() ?? raw.owner,
    description:
      raw.description?.trim() ??
      `${productName} - 基于 Electron 的跨平台桌面应用（Windows / macOS / Linux）`,
  };
}

/** 读文件（不存在返回 null） */
function readIfExists(root: string, rel: string): string | null {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** 写文件（内容未变则跳过，保证幂等且不触发无谓的 mtime 变化） */
function writeIfChanged(root: string, rel: string, next: string, dryRun: boolean): RewriteResult {
  const current = readIfExists(root, rel);
  if (current === next) {
    return { file: rel, changed: false };
  }
  if (!dryRun) {
    writeFileSync(join(root, rel), next, 'utf8');
  }
  return { file: rel, changed: true };
}

/** 对 JSON 文件做「读 → 改 → 写」；解析失败直接抛（配置文件坏了应显式暴露） */
function rewriteJson(
  root: string,
  rel: string,
  mutate: (value: Record<string, unknown>) => void,
  dryRun: boolean,
): RewriteResult {
  const current = readIfExists(root, rel);
  if (current === null) {
    return { file: rel, changed: false };
  }
  const parsed = JSON.parse(current) as Record<string, unknown>;
  mutate(parsed);
  return writeIfChanged(root, rel, `${JSON.stringify(parsed, null, 2)}\n`, dryRun);
}

/** 全量字符串替换（旧值 → 新值；相同则不改） */
function rewriteText(
  root: string,
  rel: string,
  transform: (text: string) => string,
  dryRun: boolean,
): RewriteResult {
  const current = readIfExists(root, rel);
  if (current === null) {
    return { file: rel, changed: false };
  }
  return writeIfChanged(root, rel, transform(current), dryRun);
}

/** 上一版品牌值（用于替换无法 import 真源的位置里的历史字面量） */
interface PreviousBrand {
  readonly productName: string;
  readonly protocol: string;
  readonly storagePrefix: string;
  readonly artifactBaseName: string;
  readonly owner: string;
  readonly repo: string;
}

/** 读真源 */
function readBrandConfig(root: string): BrandConfig {
  return JSON.parse(readFileSync(join(root, BRAND_SOURCE), 'utf8')) as BrandConfig;
}

/** 正则元字符转义 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 改写 app.config.json（真源） */
function writeBrandSource(root: string, input: InitInput, dryRun: boolean): RewriteResult {
  return rewriteJson(
    root,
    BRAND_SOURCE,
    (value) => {
      value['productName'] = input.productName;
      value['appId'] = input.appId;
      value['executableName'] = input.executableName;
      value['protocol'] = input.protocol;
      value['storagePrefix'] = input.storagePrefix;
      value['author'] = input.author;
      value['description'] = input.description;
      value['artifactBaseName'] = input.artifactBaseName;
      value['repo'] = { owner: input.owner, name: input.repo };
    },
    dryRun,
  );
}

/** 改写 package.json（含 repository，供 electron-builder 生成 app-update.yml） */
function writePackageJson(root: string, input: InitInput, dryRun: boolean): RewriteResult {
  return rewriteJson(
    root,
    'package.json',
    (value) => {
      value['name'] = input.executableName;
      // 派生项目尚未发布：0.0.0 作为「无已发布版本」的显式基线，
      // 首个 feat 由 release-please 升到 0.1.0（与 manifest 保持一致）
      value['version'] = '0.0.0';
      value['description'] = input.description;
      value['author'] = input.author;
      value['repository'] = {
        type: 'git',
        url: `https://github.com/${input.owner}/${input.repo}.git`,
      };
    },
    dryRun,
  );
}

/** 改写 electron-builder.yml（appId / productName / 协议 / 可执行名 / artifactName 前缀） */
function writeElectronBuilder(
  root: string,
  input: InitInput,
  previous: PreviousBrand,
  dryRun: boolean,
): RewriteResult {
  const artifactPrefix = `${input.artifactBaseName}-`;
  return rewriteText(
    root,
    'electron-builder.yml',
    (text) =>
      text
        .replace(/^appId: .*$/m, `appId: ${input.appId}`)
        .replace(/^productName: .*$/m, `productName: ${input.productName}`)
        // executableName 在 mac 段下是缩进键（^executableName 匹配不到）
        .replace(/^(\s*)executableName: .*$/m, `$1executableName: ${input.executableName}`)
        // protocols 的 name 与 schemes 两处都指向旧 scheme
        .replace(
          new RegExp(`(^\\s*-\\s+)${escapeRegExp(previous.protocol)}$`, 'gm'),
          `$1${input.protocol}`,
        )
        .replace(
          new RegExp(`(^\\s+name:\\s+)${escapeRegExp(previous.protocol)}$`, 'gm'),
          `$1${input.protocol}`,
        )
        .replaceAll(`${previous.artifactBaseName}-`, artifactPrefix)
        // deb 的 maintainer 字段携带仓库坐标（无公开邮箱时的报障入口）
        .replace(
          /^(\s*maintainer:\s*).*$/m,
          `$1${input.owner} <https://github.com/${input.owner}/${input.repo}/issues>`,
        ),
    dryRun,
  );
}

/** 改写 dev-app-update.yml（GitHub provider 坐标） */
function writeDevAppUpdate(root: string, input: InitInput, dryRun: boolean): RewriteResult {
  return rewriteText(
    root,
    'dev-app-update.yml',
    (text) =>
      text
        .replace(/^owner: .*$/m, `owner: ${input.owner}`)
        .replace(/^repo: .*$/m, `repo: ${input.repo}`)
        .replace(
          /^updaterCacheDirName: .*$/m,
          `updaterCacheDirName: ${input.executableName}-dev-updater`,
        ),
    dryRun,
  );
}

/** 改写首页品牌并同步首帧脚本的 CSP 哈希。 */
function writeIndexHtml(
  root: string,
  input: InitInput,
  previous: PreviousBrand,
  dryRun: boolean,
): RewriteResult[] {
  const file = 'src/renderer/index.html';
  const current = readIfExists(root, file);
  if (current === null) {
    return [{ file, changed: false }];
  }
  const html = current
    .replace(/<title>.*<\/title>/, `<title>${input.productName}</title>`)
    .replaceAll(
      `localStorage.getItem('${previous.storagePrefix}:theme')`,
      `localStorage.getItem('${input.storagePrefix}:theme')`,
    );
  const inline = html.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/)?.[1];
  if (inline === undefined) {
    throw new Error(`${file} 缺失首帧主题脚本，无法同步 CSP 哈希`);
  }
  const hash = `sha256-${createHash('sha256').update(inline).digest('base64')}`;
  return [
    writeIfChanged(root, file, html, dryRun),
    rewriteText(
      root,
      'src/main/security/csp.ts',
      (text) => text.replace(/'sha256-[A-Za-z0-9+/=]+'/, `'${hash}'`),
      dryRun,
    ),
  ];
}

/**
 * 改写 NSIS 安装器的协议定义
 *
 * electron-builder 的 `protocols` 只对 macOS 生效；Windows 协议由安装宏注册/卸载，
 * 因此派生项目必须同步 installer.nsh 内的协议，不能只改 electron-builder.yml。
 */
function writeInstallerProtocol(root: string, input: InitInput, dryRun: boolean): RewriteResult {
  const file = 'resources/installer.nsh';
  const current = readIfExists(root, file);
  if (current === null) {
    return { file, changed: false };
  }
  if (!/^!define APP_PROTOCOL ".*"$/m.test(current)) {
    throw new Error(`${file} 缺失 !define APP_PROTOCOL，无法同步 Windows 协议`);
  }
  return rewriteText(
    root,
    file,
    (text) =>
      text.replace(/^!define APP_PROTOCOL ".*"$/m, `!define APP_PROTOCOL "${input.protocol}"`),
    dryRun,
  );
}

/** 改写 i18n 文案里写死的旧产品名 */
function writeLocales(root: string, input: InitInput, dryRun: boolean): RewriteResult[] {
  const files = [
    'src/renderer/i18n/locales/zh-CN/common.json',
    'src/renderer/i18n/locales/en/common.json',
  ];
  return files.map((rel) =>
    rewriteText(
      root,
      rel,
      (text) => {
        const parsed = JSON.parse(text) as {
          settings?: Record<string, unknown>;
        };
        // autostartDesc 写的是产品短名（上游为「Code Agent」，不含 Desktop），
        // 全名替换匹配不到——按语言整体重写该键，保证初始化后文案自洽
        if (parsed.settings !== undefined) {
          const isZh = rel.includes('zh-CN');
          parsed.settings['autostartDesc'] = isZh
            ? `登录系统后自动在后台启动 ${input.productName}（开发模式不可用）`
            : `Start ${input.productName} in the background when you log in (packaged builds only)`;
        }
        return `${JSON.stringify(parsed, null, 2)}\n`;
      },
      dryRun,
    ),
  );
}

/** 改写 LICENSE 版权人 */
/**
 * 改写 LICENSE 版权人
 *
 * 同时支持两种常见写法：MIT 的 `Copyright (c) 2026 Name` 与
 * Apache 2.0 附录的 `Copyright 2026 Name`（后者无 `(c)`，且常带缩进）。
 * 两种都保留原有前导空白，避免破坏版权段的排版。
 */
function writeLicense(root: string, input: InitInput, dryRun: boolean): RewriteResult {
  const year = new Date().getFullYear();
  return rewriteText(
    root,
    'LICENSE',
    (text) =>
      text
        .replace(/^(\s*)Copyright \(c\) \d{4} .*$/m, `$1Copyright (c) ${year} ${input.author}`)
        .replace(/^(\s*)Copyright \d{4} .*$/m, `$1Copyright ${year} ${input.author}`),
    dryRun,
  );
}

/** 改写 CODEOWNERS 的全部 owner 占位 */
function writeCodeowners(
  root: string,
  input: InitInput,
  previous: PreviousBrand,
  dryRun: boolean,
): RewriteResult {
  return rewriteText(
    root,
    '.github/CODEOWNERS',
    (text) => text.replaceAll(`@${previous.owner}`, `@${input.owner}`),
    dryRun,
  );
}

/** 需要替换仓库 URL 的文档与模板 */
const REPO_URL_FILES = [
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.github/ISSUE_TEMPLATE/config.yml',
];

/** 改写文档中的仓库 URL 与 clone 指令 */
function writeRepoUrls(
  root: string,
  input: InitInput,
  previous: PreviousBrand,
  dryRun: boolean,
): RewriteResult[] {
  return REPO_URL_FILES.map((rel) =>
    rewriteText(
      root,
      rel,
      (text) =>
        text
          .replaceAll(
            `github.com/${previous.owner}/${previous.repo}`,
            `github.com/${input.owner}/${input.repo}`,
          )
          .replaceAll(`cd ${previous.repo}`, `cd ${input.repo}`)
          .replaceAll(`@${previous.owner}`, `@${input.owner}`),
      dryRun,
    ),
  );
}

/** CHANGELOG 的「模板说明区」标记：派生时保留标记之间的写作约定与版本段模板 */
const CHANGELOG_KEEP_START = '<!-- template:keep-start -->';
const CHANGELOG_KEEP_END = '<!-- template:keep-end -->';

/** 清空历史后的首行占位 */
const CHANGELOG_EMPTY_STATE =
  '暂无版本记录。首次发版（0.1.0）后，release-please 会在此处生成第一个版本段。';

/**
 * 生成派生项目的 CHANGELOG 骨架：保留模板说明区（写作约定 + 版本段模板），
 * 丢弃其后的全部历史版本段。
 *
 * 标记缺失时回退为最小骨架——宁可丢说明，也不把上游历史带进新项目。
 * 结果幂等：对已是骨架的输入再执行一次，输出不变。
 */
function buildChangelogSkeleton(markdown: string): string {
  const start = markdown.indexOf(CHANGELOG_KEEP_START);
  const end = markdown.indexOf(CHANGELOG_KEEP_END);
  if (start === -1 || end === -1 || end < start) {
    return `# Changelog\n\n${CHANGELOG_EMPTY_STATE}\n`;
  }
  // 只取标记之间的模板区：release-please 会把版本段插在模板区之前或之后，
  // 用「截到 keep-end」会把插入其前的历史一并保留
  const block = markdown.slice(start, end + CHANGELOG_KEEP_END.length);
  return `# Changelog\n\n${block}\n\n${CHANGELOG_EMPTY_STATE}\n`;
}

/** 重置 CHANGELOG 与 release-please 版本基线 */
function resetReleaseState(root: string, dryRun: boolean): RewriteResult[] {
  const changelog = rewriteText(root, 'CHANGELOG.md', buildChangelogSkeleton, dryRun);
  const manifest = rewriteJson(
    root,
    '.release-please-manifest.json',
    (value) => {
      value['.'] = '0.0.0';
    },
    dryRun,
  );
  // bootstrap-sha 锚定的是模板仓自己的基线提交——派生项目里该 SHA 不存在，
  // 留着会让 release-please 无法定位历史起点，必须一并清掉（只读顶层键）
  const releaseConfig = rewriteJson(
    root,
    'release-please-config.json',
    (value) => {
      delete value['bootstrap-sha'];
    },
    dryRun,
  );
  return [changelog, manifest, releaseConfig];
}

/**
 * 执行全部改写（编排层：每步只关心「文件 → 新内容」）
 *
 * @param input 已校验的初始化输入
 * @param dryRun true = 只报告将改动的文件，不落盘
 * @param root 仓库根（默认本仓库；测试注入临时副本）
 * @returns 每个文件的结果（changed 标记是否有实际差异）
 */
export function runInitTemplate(
  input: InitInput,
  dryRun: boolean,
  root: string = REPO_ROOT,
): RewriteResult[] {
  const source = readBrandConfig(root);
  const previous: PreviousBrand = {
    productName: source.productName,
    protocol: source.protocol,
    storagePrefix: source.storagePrefix,
    artifactBaseName: source.artifactBaseName,
    owner: source.repo.owner,
    repo: source.repo.name,
  };

  const results: RewriteResult[] = [
    writeBrandSource(root, input, dryRun),
    writePackageJson(root, input, dryRun),
    writeElectronBuilder(root, input, previous, dryRun),
    writeDevAppUpdate(root, input, dryRun),
    ...writeIndexHtml(root, input, previous, dryRun),
    writeInstallerProtocol(root, input, dryRun),
    ...writeLocales(root, input, dryRun),
    writeLicense(root, input, dryRun),
    writeCodeowners(root, input, previous, dryRun),
    ...writeRepoUrls(root, input, previous, dryRun),
    ...resetReleaseState(root, dryRun),
  ];

  // 生成物最后写：它由 app.config.json 派生，必须在真源落盘之后。
  // dry-run 时真源未落盘，按「目标真源」渲染以如实报告将产生的差异。
  const target = dryRun
    ? ({ ...source, ...input, repo: { owner: input.owner, name: input.repo } } as unknown as Record<
        string,
        unknown
      >)
    : (readBrandConfig(root) as unknown as Record<string, unknown>);
  results.push(writeIfChanged(root, BRAND_OUTPUT, renderBrandModule(target), dryRun));

  return results;
}

/** 允许的取值的参数（白名单：未登记的参数直接报错） */
const CLI_VALUE_KEYS = [
  'name',
  'app-id',
  'protocol',
  'owner',
  'repo',
  'author',
  'description',
  'artifact-base',
  'executable',
] as const;

/**
 * 校验 CLI 参数白名单
 *
 * parseArgs 会把任意 `--key value` 收进 values——若不校验，拼错的参数（如 `--nmae`）
 * 或本脚本不支持的参数（如误以为有 `--root`）会被静默忽略，命令仍照常改写仓库真实文件。
 * 本函数把这类输入变成显式失败。
 */
export function assertKnownCliArgs(parsed: ParsedArgs): void {
  rejectPositionals(parsed);
  for (const key of parsed.values.keys()) {
    if (!(CLI_VALUE_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `未知参数 --${key}（支持：${CLI_VALUE_KEYS.map((k) => `--${k}`).join(' / ')}；flag：--dry-run）`,
      );
    }
  }
}

/** CLI 入口 */
function main(): void {
  const parsed = parseArgs(process.argv.slice(2), ['dry-run']);
  assertKnownCliArgs(parsed);
  const dryRun = parsed.flags.has('dry-run');
  const optional = (key: string): string | undefined => parsed.values.get(key);

  const input = buildInitInput({
    productName: requireValue(parsed, 'name'),
    appId: requireValue(parsed, 'app-id'),
    protocol: requireValue(parsed, 'protocol'),
    owner: requireValue(parsed, 'owner'),
    repo: requireValue(parsed, 'repo'),
    ...(optional('author') !== undefined ? { author: optional('author') as string } : {}),
    ...(optional('description') !== undefined
      ? { description: optional('description') as string }
      : {}),
    ...(optional('artifact-base') !== undefined
      ? { artifactBaseName: optional('artifact-base') as string }
      : {}),
    ...(optional('executable') !== undefined
      ? { executableName: optional('executable') as string }
      : {}),
  });

  console.log(`[init-template]${dryRun ? '（dry-run，不落盘）' : ''}`);
  console.log(`  产品名      ${input.productName}`);
  console.log(`  appId       ${input.appId}`);
  console.log(`  协议        ${input.protocol}`);
  console.log(`  可执行名    ${input.executableName}`);
  console.log(`  存储前缀    ${input.storagePrefix}`);
  console.log(`  安装包前缀  ${input.artifactBaseName}`);
  console.log(`  仓库        ${input.owner}/${input.repo}`);
  console.log('');

  const results = runInitTemplate(input, dryRun);
  const changed = results.filter((r) => r.changed);
  for (const r of changed) {
    console.log(`  ${dryRun ? '将改动' : '已改动'}  ${r.file}`);
  }
  if (changed.length === 0) {
    console.log('  无改动（已是目标状态）');
  }

  console.log('');
  console.log('下一步：');
  console.log('  1. pnpm check:brand   # 校验品牌位点全部对齐');
  console.log('  2. pnpm typecheck && pnpm lint');
  console.log('  3. 替换 src/renderer/routes/home.tsx 为你的首屏');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error: unknown) {
    console.error(`[init-template] ❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
