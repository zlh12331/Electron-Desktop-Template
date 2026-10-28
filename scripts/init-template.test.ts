import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertKnownCliArgs,
  buildInitInput,
  deriveArtifactBaseName,
  deriveExecutableName,
  type InitInput,
  type InitOptions,
  runInitTemplate,
} from './init-template';
// notes-example:start
import { NOTES_EXAMPLE_PATHS } from './lib/notes-example';
// notes-example:end
import { parseArgs } from './scaffold/lib/args';

const REPO_ROOT = join(import.meta.dirname, '..');
const SITE_FILE = 'site/electron-desktop-template-website.html';
const STATIC_WORKFLOW = '.github/workflows/static.yml';
/** 派生项目默认已删除模板营销站：站点专属断言在派生副本中跳过 */
const HAS_SITE = existsSync(join(REPO_ROOT, SITE_FILE));

/** 复制单个文件/目录到临时副本（保留相对路径） */
function copyPath(dir: string, rel: string): void {
  const source = join(REPO_ROOT, rel);
  if (!existsSync(source)) {
    return;
  }
  const dest = join(dir, rel);
  if (statSync(source).isDirectory()) {
    cpSync(source, dest, { recursive: true });
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(source, dest);
}

/** 复制到临时目录执行（避免改动真实仓库） */
function copyToTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'code-agent-init-'));
  for (const rel of [
    'app.config.json',
    'package.json',
    'electron-builder.yml',
    'dev-app-update.yml',
    'LICENSE',
    'CHANGELOG.md',
    '.release-please-manifest.json',
    'release-please-config.json',
    '.github',
    'src/renderer/index.html',
    'resources/installer.nsh',
    'src/main/security/csp.ts',
    'src/renderer/i18n/locales',
    'packages/shared/src/constants',
    'packages/shared/package.json',
    'packages/shared/tsconfig.json',
    'packages/tsconfig',
    'tsconfig.json',
    'scripts/test-boundary-exempt.json',
    'scripts/init-template.test.ts',
    'pnpm-lock.yaml',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'site',
  ]) {
    copyPath(dir, rel);
  }
  // notes-example:start
  // Local Notes 触点的真实文件（移除器测试直接跑在模板的真实内容上，
  // 但不复制整个 src/，避免 init 用例被无关文件的 scope 扫描拖慢）
  for (const rel of [
    ...NOTES_EXAMPLE_PATHS.dirs,
    ...NOTES_EXAMPLE_PATHS.files,
    ...NOTES_EXAMPLE_PATHS.marked,
    'src/renderer/hooks/use-deep-link.ts',
    'e2e/electron-deeplink.spec.ts',
    'drizzle/meta/_journal.json',
    'drizzle/0001_lazy_mad_thinker.sql',
    'drizzle/meta/0001_snapshot.json',
  ]) {
    copyPath(dir, rel);
  }
  // notes-example:end
  return dir;
}

describe('deriveExecutableName / deriveArtifactBaseName', () => {
  it('产品名 → 可执行名（小写连字符）', () => {
    expect(deriveExecutableName('My App')).toBe('my-app');
    expect(deriveExecutableName('  Foo__Bar  ')).toBe('foo-bar');
    expect(deriveExecutableName('A')).toBe('a');
  });

  it('可执行名 → 安装包前缀（Title-Case）', () => {
    expect(deriveArtifactBaseName('my-app')).toBe('My-App');
    expect(deriveArtifactBaseName('a')).toBe('A');
  });
});

describe('buildInitInput 校验', () => {
  const base = {
    productName: 'My App',
    appId: 'com.me.myapp',
    protocol: 'myapp',
    owner: 'me',
    repo: 'myapp',
  };

  it('正向：缺省 author 回落 owner，自动推导可执行名与前缀', () => {
    const input = buildInitInput(base);
    expect(input.executableName).toBe('my-app');
    expect(input.artifactBaseName).toBe('My-App');
    expect(input.storagePrefix).toBe('my-app');
    expect(input.author).toBe('me');
    expect(input.internalScope).toBe('me');
    expect(input.description).toContain('My App');
  });

  it('内部 scope：缺省按 owner 小写推导，显式 scope 归一化并校验', () => {
    expect(buildInitInput({ ...base, owner: 'Acme-Org' }).internalScope).toBe('acme-org');
    expect(buildInitInput({ ...base, internalScope: '@Acme.UI' }).internalScope).toBe('acme.ui');
    expect(() => buildInitInput({ ...base, internalScope: 'bad scope' })).toThrow(/--scope/);
  });

  it('非法 appId 抛错', () => {
    expect(() => buildInitInput({ ...base, appId: 'MyApp' })).toThrow(/app-id/);
    expect(() => buildInitInput({ ...base, appId: 'com..myapp' })).toThrow(/app-id/);
  });

  it('非法 protocol / owner / repo 抛错', () => {
    expect(() => buildInitInput({ ...base, protocol: 'My App' })).toThrow(/protocol/);
    expect(() => buildInitInput({ ...base, owner: '-me' })).toThrow(/owner/);
    expect(() => buildInitInput({ ...base, repo: 'my app' })).toThrow(/repo/);
  });

  it('空产品名抛错', () => {
    expect(() => buildInitInput({ ...base, productName: '   ' })).toThrow(/--name/);
  });

  it('非 ASCII 产品名：缺省推导给出 --executable 指引', () => {
    expect(() => buildInitInput({ ...base, productName: '演示应用' })).toThrow(/--executable/);
  });

  it('非 ASCII 产品名：显式 executable 可正常初始化', () => {
    const input = buildInitInput({
      ...base,
      productName: '演示应用',
      executableName: 'demo-app',
    });
    expect(input.executableName).toBe('demo-app');
    expect(input.artifactBaseName).toBe('Demo-App');
    expect(input.storagePrefix).toBe('demo-app');
  });

  it('显式 executable 非法时报告参数名而非产品名', () => {
    expect(() => buildInitInput({ ...base, executableName: 'Bad_Name' })).toThrow(
      /--executable 格式非法/,
    );
  });
});

describe('assertKnownCliArgs：未知参数必须显式失败', () => {
  it('正向：登记过的参数与 --dry-run / --keep-site 通过', () => {
    const parsed = parseArgs(
      ['--name', 'My App', '--app-id', 'com.me.app', '--scope', 'acme', '--dry-run', '--keep-site'],
      ['dry-run', 'keep-site'],
    );
    expect(() => assertKnownCliArgs(parsed)).not.toThrow();
  });

  it('回归：--root 不被支持时必须报错（曾被静默忽略、直接改真实仓库）', () => {
    const parsed = parseArgs(['--name', 'My App', '--root', 'some/dir']);
    expect(() => assertKnownCliArgs(parsed)).toThrow(/未知参数 --root/);
  });

  it('回归：拼错的参数名报错，而不是被当作有效参数吞掉', () => {
    const parsed = parseArgs(['--nmae', 'My App']);
    expect(() => assertKnownCliArgs(parsed)).toThrow(/未知参数 --nmae/);
  });

  it('边界：裸参数同样拒绝', () => {
    const parsed = parseArgs(['--name', 'My App', 'stray']);
    expect(() => assertKnownCliArgs(parsed)).toThrow(/不支持的裸参数/);
  });
});

describe('runInitTemplate（临时副本，真实文件系统）', () => {
  let dir: string;
  let input: InitInput;

  beforeEach(() => {
    dir = copyToTemp();
    input = buildInitInput({
      productName: 'Acme Notes',
      appId: 'com.acme.notes',
      protocol: 'acmenotes',
      owner: 'acme',
      repo: 'acme-notes',
      author: 'Acme Inc.',
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 在临时副本上跑一次（root 显式传入，不依赖 cwd） */
  function runIn(
    dirPath: string,
    dryRun = false,
    options: InitOptions = {},
  ): ReturnType<typeof runInitTemplate> {
    return runInitTemplate(input, dryRun, dirPath, options);
  }

  it('dry-run：报告将改动的文件但不落盘', () => {
    const files = [
      'app.config.json',
      'src/renderer/index.html',
      'src/main/security/csp.ts',
      'resources/installer.nsh',
    ];
    const before = files.map((file) => readFileSync(join(dir, file), 'utf8'));
    const results = runIn(dir, true);

    expect(results.some((r) => r.changed)).toBe(true);
    expect(results).toContainEqual({ file: 'src/main/security/csp.ts', changed: true });
    expect(results).toContainEqual({ file: 'resources/installer.nsh', changed: true });
    expect(files.map((file) => readFileSync(join(dir, file), 'utf8'))).toEqual(before);
    expect(existsSync(join(dir, SITE_FILE))).toBe(HAS_SITE);
  });

  it.skipIf(!HAS_SITE)('默认移除模板营销站与 Pages workflow', () => {
    const results = runIn(dir);

    expect(results).toContainEqual({ file: 'site', changed: true });
    expect(results).toContainEqual({ file: STATIC_WORKFLOW, changed: true });
    expect(existsSync(join(dir, 'site'))).toBe(false);
    expect(existsSync(join(dir, STATIC_WORKFLOW))).toBe(false);
  });

  it.skipIf(!HAS_SITE)('默认移除只删模板站点文件：目录内有自建内容时保留 Pages workflow', () => {
    writeFileSync(join(dir, 'site', 'custom.html'), 'custom', 'utf8');
    const results = runIn(dir);

    expect(existsSync(join(dir, SITE_FILE))).toBe(false);
    expect(existsSync(join(dir, 'site', 'custom.html'))).toBe(true);
    expect(existsSync(join(dir, STATIC_WORKFLOW))).toBe(true);
    expect(results).not.toContainEqual({ file: STATIC_WORKFLOW, changed: true });
  });

  it.skipIf(!HAS_SITE)('--keep-site：保留站点并改写品牌、仓库与版本', () => {
    const before = readFileSync(join(dir, SITE_FILE), 'utf8');
    const results = runIn(dir, false, { keepSite: true });
    const site = readFileSync(join(dir, SITE_FILE), 'utf8');

    expect(before).toContain('Electron Desktop Template');
    expect(site).toContain('<title>Acme Notes');
    expect(site).toContain('<span class="brand-name">Acme Notes</span>');
    expect(site).toContain('https://github.com/acme/acme-notes');
    expect(site).toContain('v0.0.0');
    expect(site).not.toContain('zlh12331/Electron-Desktop-Template');
    expect(site).not.toContain('Electron Desktop Template');
    expect(existsSync(join(dir, STATIC_WORKFLOW))).toBe(true);
    expect(results).toContainEqual({ file: SITE_FILE, changed: true });
  });

  it.skipIf(!HAS_SITE)('--keep-site：内嵌 SVG favicon 的产品名也被改写', () => {
    runIn(dir, false, { keepSite: true });
    const site = readFileSync(join(dir, SITE_FILE), 'utf8');
    const encoded = /href="data:image\/svg\+xml;base64,([^"]+)"/.exec(site)?.[1];

    expect(encoded).toBeDefined();
    const svg = Buffer.from(encoded ?? '', 'base64').toString('utf8');
    expect(svg).toContain('Acme Notes');
    expect(svg).not.toContain('Electron Desktop Template');
  });

  // notes-example:start
  it('默认移除 Local Notes 参考切片、迁移与文档登记', () => {
    const results = runIn(dir);

    expect(results).toContainEqual({ file: 'src/renderer/routes/notes.tsx', changed: true });
    for (const rel of [
      'src/renderer/routes/notes.tsx',
      'src/renderer/hooks/use-notes.ts',
      'src/main/infra/notes',
      'src/main/ipc/notes.handler.ts',
      'packages/shared/src/schemas/notes.ts',
      'packages/shared/src/ipc/domains/notes.ts',
      'e2e/notes.spec.ts',
      'docs/design/notes-example.md',
      'scripts/remove-notes-example.ts',
      'scripts/lib/notes-example.test.ts',
      'drizzle/0001_lazy_mad_thinker.sql',
      'drizzle/meta/0001_snapshot.json',
    ]) {
      expect(existsSync(join(dir, rel))).toBe(false);
    }

    const boundary = JSON.parse(
      readFileSync(join(dir, 'scripts/test-boundary-exempt.json'), 'utf8'),
    ) as { entries: { file: string }[] };
    expect(boundary.entries.map((entry) => entry.file)).not.toContain(
      'src/main/infra/notes/notes-repository.test.ts',
    );

    const meta = readFileSync(join(dir, 'packages/shared/src/ipc/meta.ts'), 'utf8');
    expect(meta).not.toContain('notes');
    expect(meta).not.toContain('notes-example');

    const journal = JSON.parse(readFileSync(join(dir, 'drizzle/meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]?.tag.startsWith('0001_')).toBe(false);

    const doc = readFileSync(join(dir, 'docs/design/19-ipc-spec.md'), 'utf8');
    expect(doc).toContain('13 域 50 channel');
    expect(doc).toContain('共 45 个 request 通道 + 5 个 event 通道');
    expect(doc).not.toContain('notes');
    expect(doc).toContain('invalidation / proxy');

    for (const locale of ['zh-CN', 'en']) {
      const parsed = JSON.parse(
        readFileSync(join(dir, `src/renderer/i18n/locales/${locale}/common.json`), 'utf8'),
      ) as Record<string, unknown> & { sidebar?: { nav?: Record<string, unknown> } };
      expect(parsed).not.toHaveProperty('notes');
      expect(parsed.sidebar?.nav).not.toHaveProperty('notes');
    }

    const deepLink = readFileSync(join(dir, 'src/renderer/hooks/use-deep-link.ts'), 'utf8');
    expect(deepLink).toContain('navigate(ROUTES.home);');
    expect(deepLink).not.toContain('ROUTES.note');

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts).not.toHaveProperty('remove:notes-example');

    for (const rel of ['README.md', 'AGENTS.md', 'docs/README.md', 'docs/design/README.md']) {
      const text = readFileSync(join(dir, rel), 'utf8');
      expect(text).not.toContain('notes-example');
      expect(text).not.toContain('Local Notes');
    }
  });

  it('--keep-example：保留示例、迁移与文档登记', () => {
    runIn(dir, false, { keepExample: true });

    for (const rel of [
      'src/renderer/routes/notes.tsx',
      'src/renderer/hooks/use-notes.ts',
      'src/main/infra/notes/notes-repository.ts',
      'packages/shared/src/schemas/notes.ts',
      'e2e/notes.spec.ts',
      'docs/design/notes-example.md',
      'scripts/remove-notes-example.ts',
      'drizzle/0001_lazy_mad_thinker.sql',
      'drizzle/meta/0001_snapshot.json',
    ]) {
      expect(existsSync(join(dir, rel))).toBe(true);
    }
    expect(readFileSync(join(dir, 'packages/shared/src/ipc/meta.ts'), 'utf8')).toContain(
      'notes-example:start',
    );
    expect(readFileSync(join(dir, 'docs/design/19-ipc-spec.md'), 'utf8')).toContain(
      '14 域 57 channel',
    );
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toContain('"remove:notes-example"');
  });

  it('--keep-example：示例保留时重复执行仍幂等', () => {
    runIn(dir, false, { keepExample: true });
    const second = runIn(dir, false, { keepExample: true });
    expect(second.filter((result) => result.changed)).toEqual([]);
  });
  // notes-example:end

  it('品牌改写同步首帧脚本的 CSP 哈希且不放宽策略', () => {
    const beforeCsp = readFileSync(join(dir, 'src/main/security/csp.ts'), 'utf8');
    runIn(dir);

    const html = readFileSync(join(dir, 'src/renderer/index.html'), 'utf8');
    const inline = html.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/)?.[1];
    expect(inline).toContain("localStorage.getItem('acme-notes:theme')");
    const hash = `sha256-${createHash('sha256')
      .update(inline ?? '')
      .digest('base64')}`;
    const csp = readFileSync(join(dir, 'src/main/security/csp.ts'), 'utf8');
    expect(csp).toContain(`'${hash}'`);
    expect(csp).toBe(beforeCsp.replace(/'sha256-[A-Za-z0-9+/=]+'/g, `'${hash}'`));
    expect(runIn(dir).every((result) => !result.changed)).toBe(true);
  });

  it('正向：品牌真源、package.json、构建配置全部对齐', () => {
    runIn(dir);

    const brand = JSON.parse(readFileSync(join(dir, 'app.config.json'), 'utf8')) as {
      productName: string;
      appId: string;
      executableName: string;
      protocol: string;
      storagePrefix: string;
      artifactBaseName: string;
      repo: { owner: string; name: string };
    };
    expect(brand).toMatchObject({
      productName: 'Acme Notes',
      appId: 'com.acme.notes',
      executableName: 'acme-notes',
      protocol: 'acmenotes',
      storagePrefix: 'acme-notes',
      artifactBaseName: 'Acme-Notes',
      repo: { owner: 'acme', name: 'acme-notes' },
    });

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
      repository: { url: string };
    };
    expect(pkg.name).toBe('acme-notes');
    // 0.0.0 = 尚未发布；首个 feat 由 release-please 升到 0.1.0
    expect(pkg.version).toBe('0.0.0');
    expect(pkg.repository.url).toBe('https://github.com/acme/acme-notes.git');

    const builder = readFileSync(join(dir, 'electron-builder.yml'), 'utf8');
    expect(builder).toContain('appId: com.acme.notes');
    expect(builder).toContain('productName: Acme Notes');
    expect(builder).toContain('executableName: acme-notes');
    expect(builder).toContain('Acme-Notes-Windows-');
    expect(builder).toContain('Acme-Notes-macOS-');
    expect(builder).toContain('Acme-Notes-Linux-');
    expect(builder).toContain('name: acmenotes');
    expect(builder).toContain('synopsis: Acme Notes');
    expect(builder).toContain(`description: ${input.description}`);
    expect(builder).toContain('        - acmenotes');
    expect(builder).not.toContain('Code-Agent-Desktop');
    expect(builder).not.toContain('code-agent');

    const installer = readFileSync(join(dir, 'resources/installer.nsh'), 'utf8');
    expect(installer).toContain('!define APP_PROTOCOL "acmenotes"');
    expect(installer).not.toContain('!define APP_PROTOCOL "electron-template"');

    const devUpdate = readFileSync(join(dir, 'dev-app-update.yml'), 'utf8');
    expect(devUpdate).toContain('owner: acme');
    expect(devUpdate).toContain('repo: acme-notes');
  });

  it('正向：index.html / LICENSE / CODEOWNERS / 文档 URL 同步', () => {
    runIn(dir);

    const html = readFileSync(join(dir, 'src/renderer/index.html'), 'utf8');
    expect(html).toContain('<title>Acme Notes</title>');
    expect(html).toContain("localStorage.getItem('acme-notes:theme')");

    const license = readFileSync(join(dir, 'LICENSE'), 'utf8');
    // 兼容 MIT（Copyright (c) YYYY Name）与 Apache 2.0（Copyright YYYY Name）两种版权行
    expect(license).toMatch(/Copyright (?:\(c\) )?\d{4} Acme Inc\./);

    const owners = readFileSync(join(dir, '.github/CODEOWNERS'), 'utf8');
    expect(owners).not.toContain('@zlh12331');
    expect(owners).toContain('@acme');

    const contributing = readFileSync(join(dir, 'CONTRIBUTING.md'), 'utf8');
    expect(contributing).toContain('github.com/acme/acme-notes');
    expect(contributing).not.toContain('zlh12331');
  });

  it('GitHub 自动化不含仓库坐标与产物名前缀（靠运行时上下文，不靠替换）', () => {
    // 派生项目可能直接 fork 而不跑 init:template——workflow 必须自行取上下文，
    // 因此断言的是「模板出厂即干净」，而不是「初始化后变成干净」
    for (const rel of [
      '.github/workflows/discussion-welcome.yml',
      '.github/workflows/first-interaction.yml',
      '.github/workflows/issue-metrics.yml',
      '.github/workflows/release.yml',
    ]) {
      const text = readFileSync(join(dir, rel), 'utf8');
      expect(text).not.toMatch(/zlh12331\/superagent/);
      expect(text).not.toContain('Code-Agent-Desktop');
    }
    const metrics = readFileSync(join(dir, '.github/workflows/issue-metrics.yml'), 'utf8');
    expect(metrics).toContain('github.repository');
    const release = readFileSync(join(dir, '.github/workflows/release.yml'), 'utf8');
    expect(release).toContain('context.repo.repo');
    expect(release).toContain("require('./app.config.json').artifactBaseName");
  });

  it('正向：生成物 brand.ts 与真源一致', () => {
    runIn(dir);

    const brandModule = readFileSync(join(dir, 'packages/shared/src/constants/brand.ts'), 'utf8');
    expect(brandModule).toContain("export const PRODUCT_NAME = 'Acme Notes';");
    expect(brandModule).toContain("export const APP_ID = 'com.acme.notes';");
    expect(brandModule).toContain("export const REPO_OWNER = 'acme';");
  });

  it('正向：内部 workspace scope 同步包名、依赖、tsconfig 与锁文件', () => {
    runIn(dir);

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies['@acme/shared']).toBe('workspace:*');
    expect(pkg.devDependencies['@acme/tsconfig']).toBe('workspace:*');
    expect(pkg.devDependencies).not.toHaveProperty('@code-agent/shared');

    const sharedPkg = JSON.parse(
      readFileSync(join(dir, 'packages/shared/package.json'), 'utf8'),
    ) as { name: string; devDependencies: Record<string, string> };
    expect(sharedPkg.name).toBe('@acme/shared');
    expect(sharedPkg.devDependencies['@acme/tsconfig']).toBe('workspace:*');

    const tsconfig = readFileSync(join(dir, 'packages/shared/tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('@acme/tsconfig');
    expect(tsconfig).not.toContain('@code-agent/');

    const lockfile = readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8');
    expect(lockfile).toContain('@acme/shared');
    expect(lockfile).not.toContain('@code-agent/');
  });

  it('正向：CHANGELOG 清空历史但保留写作模板，release manifest 归零', () => {
    // 在副本里模拟一次真实发版：release-please 把版本段插在标题与模板区之间
    const changelogPath = join(dir, 'CHANGELOG.md');
    const original = readFileSync(changelogPath, 'utf8').replace(
      '# Changelog\n',
      '# Changelog\n\n## [9.9.9](https://github.com/upstream/repo/compare/v9.9.8...v9.9.9) (2026-10-01)\n\n### 新增\n\n- 上游历史条目\n',
    );
    writeFileSync(changelogPath, original);
    const configPath = join(dir, 'release-please-config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    config['bootstrap-sha'] = 'a'.repeat(40);
    writeFileSync(configPath, JSON.stringify(config));

    runIn(dir);

    const changelog = readFileSync(changelogPath, 'utf8');
    expect(changelog).toContain('# Changelog');
    // 上游版本历史（无论在模板区前还是后）都不得带入派生项目
    expect(changelog).not.toContain('9.9.9');
    expect(changelog).not.toContain('1.9.0');
    expect(changelog).not.toContain('superagent/compare');
    // 写作约定与版本段模板必须保留（否则派生项目只能从零起草）
    expect(changelog).toContain('<!-- template:keep-start -->');
    expect(changelog).toContain('<!-- template:keep-end -->');
    expect(changelog).toContain('## 怎么写');
    expect(changelog).toContain('分组顺序固定');
    expect(changelog).toContain('暂无版本记录');

    const manifest = JSON.parse(
      readFileSync(join(dir, '.release-please-manifest.json'), 'utf8'),
    ) as Record<string, string>;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(manifest['.']).toBe('0.0.0');
    expect(pkg.version).toBe(manifest['.']);

    // bootstrap-sha 锚定模板仓自己的基线提交，派生项目里不存在，必须被清掉
    const releaseConfig = JSON.parse(
      readFileSync(join(dir, 'release-please-config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(releaseConfig).not.toHaveProperty('bootstrap-sha');
  });

  it('bootstrap-sha 可省略，配置时必须是顶层完整 SHA', () => {
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, 'release-please-config.json'), 'utf8'),
    ) as Record<string, unknown> & { packages: Record<string, Record<string, unknown>> };
    if ('bootstrap-sha' in config) {
      expect(config['bootstrap-sha']).toMatch(/^[a-f\d]{40}$/);
    }
    for (const pkg of Object.values(config.packages)) {
      expect(pkg).not.toHaveProperty('bootstrap-sha');
    }
  });

  it('幂等：CHANGELOG 骨架重复执行不再变化', () => {
    runIn(dir);
    const once = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    runIn(dir);
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toBe(once);
  });

  it('幂等：连续执行两次，第二次无改动', () => {
    runIn(dir);
    const second = runIn(dir);

    expect(second.filter((r) => r.changed)).toEqual([]);
  });

  it('残留检查：初始化后不再有上游品牌与仓库坐标', () => {
    runIn(dir);

    const scanned = [
      'app.config.json',
      'package.json',
      'electron-builder.yml',
      'dev-app-update.yml',
      'LICENSE',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'CODE_OF_CONDUCT.md',
      '.github/CODEOWNERS',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/workflows/discussion-welcome.yml',
      '.github/workflows/first-interaction.yml',
      '.github/workflows/issue-metrics.yml',
      '.github/workflows/release.yml',
      'src/renderer/index.html',
      'src/renderer/i18n/locales/zh-CN/common.json',
      'src/renderer/i18n/locales/en/common.json',
      'packages/shared/src/constants/brand.ts',
      'resources/installer.nsh',
    ];
    const leaks: string[] = [];
    for (const rel of scanned) {
      const text = readFileSync(join(dir, rel), 'utf8');
      if (/zlh12331|superagent|Code Agent Desktop/.test(text)) {
        leaks.push(rel);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('边界：目标文件缺失时不崩（跳过该文件）', () => {
    rmSync(join(dir, 'dev-app-update.yml'));
    expect(() => runIn(dir)).not.toThrow();
  });

  it('边界：package.json 非法 JSON 时显式抛错（不静默跳过）', () => {
    writeFileSync(join(dir, 'package.json'), '{ invalid', 'utf8');
    expect(() => runIn(dir)).toThrow();
  });

  it('端到端：初始化后品牌闸通过（复刻 check:brand 的判据）', () => {
    runIn(dir);

    const brand = JSON.parse(readFileSync(join(dir, 'app.config.json'), 'utf8')) as {
      productName: string;
      appId: string;
      executableName: string;
      protocol: string;
      storagePrefix: string;
      author: string;
      description: string;
      artifactBaseName: string;
      repo: { owner: string; name: string };
    };
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const builder = readFileSync(join(dir, 'electron-builder.yml'), 'utf8');
    const html = readFileSync(join(dir, 'src/renderer/index.html'), 'utf8');
    const devUpdate = readFileSync(join(dir, 'dev-app-update.yml'), 'utf8');

    expect(pkg['name']).toBe(brand.executableName);
    expect(pkg['description']).toBe(brand.description);
    expect(pkg['author']).toBe(brand.author);
    expect((pkg['repository'] as { url: string }).url).toBe(
      `https://github.com/${brand.repo.owner}/${brand.repo.name}.git`,
    );
    expect(builder).toContain(`appId: ${brand.appId}`);
    expect(builder).toContain(`productName: ${brand.productName}`);
    expect(builder).toContain(`executableName: ${brand.executableName}`);
    expect(builder).toContain(`name: ${brand.protocol}`);
    expect(builder).toContain(`synopsis: ${brand.productName}`);
    expect(builder).toContain(`description: ${brand.description}`);
    expect(builder).toContain(`        - ${brand.protocol}`);
    expect(builder).toContain(`artifactName: ${brand.artifactBaseName}-Windows-`);
    expect(html).toContain(`<title>${brand.productName}</title>`);
    expect(html).toContain(`localStorage.getItem('${brand.storagePrefix}:theme')`);
    expect(devUpdate).toContain(`owner: ${brand.repo.owner}`);
    expect(devUpdate).toContain(`repo: ${brand.repo.name}`);
  });
});

describe('模板出厂状态', () => {
  it('版本基线一致：package.json 与 release manifest 相同', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, '.release-please-manifest.json'), 'utf8'),
    ) as Record<string, string>;
    expect(pkg.version).toBe(manifest['.']);
  });
});
