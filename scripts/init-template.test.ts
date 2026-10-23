import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertKnownCliArgs,
  buildInitInput,
  deriveArtifactBaseName,
  deriveExecutableName,
  type InitInput,
  runInitTemplate,
} from './init-template';
import { parseArgs } from './scaffold/lib/args';

const REPO_ROOT = join(import.meta.dirname, '..');

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
    'src/renderer/i18n/locales',
    'packages/shared/src/constants',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
  ]) {
    cpSync(join(REPO_ROOT, rel), join(dir, rel), { recursive: true });
  }
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
    expect(input.description).toContain('My App');
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
});

describe('assertKnownCliArgs：未知参数必须显式失败', () => {
  it('正向：登记过的参数与 --dry-run 通过', () => {
    const parsed = parseArgs(
      ['--name', 'My App', '--app-id', 'com.me.app', '--dry-run'],
      ['dry-run'],
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
  function runIn(dirPath: string, dryRun = false): ReturnType<typeof runInitTemplate> {
    return runInitTemplate(input, dryRun, dirPath);
  }

  it('dry-run：报告将改动的文件但不落盘', () => {
    const before = readFileSync(join(dir, 'app.config.json'), 'utf8');
    const results = runIn(dir, true);

    expect(results.some((r) => r.changed)).toBe(true);
    expect(readFileSync(join(dir, 'app.config.json'), 'utf8')).toBe(before);
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
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.repository.url).toBe('https://github.com/acme/acme-notes.git');

    const builder = readFileSync(join(dir, 'electron-builder.yml'), 'utf8');
    expect(builder).toContain('appId: com.acme.notes');
    expect(builder).toContain('productName: Acme Notes');
    expect(builder).toContain('executableName: acme-notes');
    expect(builder).toContain('Acme-Notes-Windows-');
    expect(builder).toContain('Acme-Notes-macOS-');
    expect(builder).toContain('Acme-Notes-Linux-');
    expect(builder).toContain('        - acmenotes');
    expect(builder).not.toContain('Code-Agent-Desktop');

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

  it('正向：CHANGELOG 清空历史但保留写作模板，release manifest 归零', () => {
    // 在副本里模拟一次真实发版：release-please 把版本段插在标题与模板区之间
    const changelogPath = join(dir, 'CHANGELOG.md');
    const original = readFileSync(changelogPath, 'utf8').replace(
      '# Changelog\n',
      '# Changelog\n\n## [9.9.9](https://github.com/upstream/repo/compare/v9.9.8...v9.9.9) (2026-10-01)\n\n### 新增\n\n- 上游历史条目\n',
    );
    writeFileSync(changelogPath, original);

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
    expect(manifest['.']).toBe('0.1.0');

    // bootstrap-sha 锚定模板仓自己的基线提交，派生项目里不存在，必须被清掉
    const releaseConfig = JSON.parse(
      readFileSync(join(dir, 'release-please-config.json'), 'utf8'),
    ) as { packages: Record<string, Record<string, unknown>> };
    expect(releaseConfig.packages['.']).not.toHaveProperty('bootstrap-sha');
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
