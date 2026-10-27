import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countIpcMetaSource,
  NOTES_EXAMPLE_PATHS,
  removeNotesExample,
  stripNotesMarkers,
} from './notes-example';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** 在临时根下写文件（自动建父目录） */
function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** 读取文本 */
function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

/** 构造一个覆盖全部触点形态的最小仓库 */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'notes-example-'));
  write(
    root,
    'packages/shared/src/ipc/meta.ts',
    [
      'export const IPC_META = {',
      '  app: {',
      "    getStatus: request('app:getStatus'),",
      '  },',
      '  // notes-example:start',
      '  notes: {',
      "    list: request('notes:list'),",
      "    get: request('notes:get'),",
      '  },',
      '  // notes-example:end',
      '  update: {',
      "    check: request('update:check'),",
      "    subscribeStatus: event('update:event:status'),",
      '  },',
      '} as const;',
    ].join('\n'),
  );
  write(
    root,
    'packages/shared/src/ipc/domains/index.ts',
    [
      "import { appDomain } from './app';",
      '// notes-example:start',
      "import { notesDomain } from './notes';",
      '// notes-example:end',
      "import { updateDomain } from './update';",
    ].join('\n'),
  );
  write(
    root,
    'packages/shared/src/schemas/invalidation.ts',
    ['export const INVALIDATION_DOMAINS = {', "  update: 'update',", '};'].join('\n'),
  );
  write(
    root,
    'src/renderer/lib/constants.ts',
    [
      'export const ROUTES = {',
      '  // notes-example:start',
      "  notes: '/notes',",
      '  // notes-example:end',
      '} as const;',
    ].join('\n'),
  );
  write(
    root,
    'src/renderer/components/layout/Sidebar.tsx',
    [
      "import { NotebookPen, Settings2 } from 'lucide-react';",
      '// notes-example:start',
      'const noteIcon = NotebookPen;',
      'void noteIcon;',
      '// notes-example:end',
      'export { Settings2 };',
    ].join('\n'),
  );
  write(
    root,
    'src/renderer/dev/mock-api.ts',
    [
      'import {',
      '  IPC_PROTOCOL_VERSION,',
      '  type IpcApi,',
      '  type Note,',
      '  type UpdateStatusPayload,',
      "} from '@code-agent/shared/renderer';",
      "import { ipcErr, ipcOk } from '@/lib/ipc-factories';",
      '// notes-example:start',
      "const example: Note = { id: 'x', title: '', body: '', createdAt: 0, updatedAt: 0 };",
      'void example;',
      'void ipcErr;',
      '// notes-example:end',
      'export type Api = IpcApi;',
      'export type Payload = UpdateStatusPayload;',
      'void IPC_PROTOCOL_VERSION;',
      'void ipcOk;',
    ].join('\n'),
  );
  write(
    root,
    'src/renderer/hooks/use-deep-link.ts',
    [
      '/**',
      ' * 收到协议唤起时导航到目标页面。示例切片把 payload.targetId 解析为笔记 id，',
      ' * 直接打开 `/notes/<id>`（目标不存在时页面显示「笔记不存在」）。',
      ' * 接入业务后把这里换成真实的路由解析。',
      ' */',
      'export function useDeepLink(): void {',
      '  const handlePayload = (payload: { targetId: string | null }): void => {',
      '    if (payload.targetId === null) return;',
      '      // 深链示例：targetId 视作笔记 id，打开参考切片的详情页',
      '      navigate(ROUTES.note(payload.targetId));',
      '  };',
      '}',
    ].join('\n'),
  );
  write(
    root,
    'src/renderer/hooks/use-deep-link.test.tsx',
    [
      "expect(router.state.location.pathname).toBe('/notes/abc');",
      "await waitFor(() => expect(router.state.location.pathname).toBe('/notes/cold'));",
      '// notes-example:start',
      "const route = '/notes/:id';",
      'void route;',
      '// notes-example:end',
    ].join('\n'),
  );
  write(
    root,
    'e2e/electron-deeplink.spec.ts',
    [
      'await expect(page).toHaveURL(/#\\/notes\\/e2e-deep-link$/, { timeout: 15_000 });',
      "    await expect(page.getByText('笔记不存在')).toBeVisible();",
    ].join('\n'),
  );
  for (const locale of ['zh-CN', 'en']) {
    write(
      root,
      `src/renderer/i18n/locales/${locale}/common.json`,
      `${JSON.stringify(
        {
          update: { notesTitle: '更新说明' },
          notes: { title: 'Local Notes' },
          sidebar: { nav: { notes: '笔记', settings: '设置' } },
        },
        null,
        2,
      )}\n`,
    );
  }
  write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        scripts: { 'remove:notes-example': 'tsx scripts/remove-notes-example.ts', test: 'vitest' },
      },
      null,
      2,
    )}\n`,
  );
  write(
    root,
    'docs/design/19-ipc-spec.md',
    [
      '# IPC',
      '> 最后同步：2026-01-01（模板版 + Local Notes 示例：3 域 5 channel = 4 request + 1 event）',
      '',
      '域清单（IPC_META 中，实测 3 个）：',
      '`app / notes / update`。',
      '共 4 个 request 通道 + 1 个 event 通道（2026-01-01 实测）。',
      '',
      '<!-- notes-example:start -->',
      '> Notes 扩展点说明。',
      '<!-- notes-example:end -->',
      '',
      'schemas：`app / invalidation / notes / proxy`。',
    ].join('\n'),
  );
  write(
    root,
    'drizzle/meta/_journal.json',
    `${JSON.stringify(
      {
        version: '7',
        dialect: 'sqlite',
        entries: [
          { idx: 0, version: '6', when: 1, tag: '0000_init', breakpoints: true },
          { idx: 1, version: '6', when: 2, tag: '0001_lazy_mad_thinker', breakpoints: true },
        ],
      },
      null,
      2,
    )}\n`,
  );
  write(root, 'drizzle/0001_lazy_mad_thinker.sql', 'CREATE TABLE `notes` (id text);\n');
  write(root, 'drizzle/meta/0001_snapshot.json', '{}\n');
  write(
    root,
    'scripts/test-boundary-exempt.json',
    `${JSON.stringify(
      {
        entries: [
          { file: 'src/main/infra/storage/backup-store.test.ts', signals: ['better-sqlite3'] },
          {
            file: 'src/main/infra/notes/notes-repository.test.ts',
            signals: ['better-sqlite3'],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  for (const rel of [
    'src/main/infra/notes/notes-repository.ts',
    'src/renderer/components/notes/note-list.tsx',
    'src/main/ipc/notes.handler.ts',
  ]) {
    write(root, rel, 'export const x = 1;\n');
  }
  for (const rel of NOTES_EXAMPLE_PATHS.files) {
    write(root, rel, '// example file\n');
  }
  for (const rel of NOTES_EXAMPLE_PATHS.marked) {
    if (existsSync(join(root, rel))) continue;
    write(root, rel, 'keep\n// notes-example:start\ndrop\n// notes-example:end\n');
  }
  return root;
}

describe('stripNotesMarkers', () => {
  it('删除成对标记块（含缩进与 HTML 注释）', () => {
    const input = [
      'keep-1',
      '  // notes-example:start',
      '  drop-1',
      '  // notes-example:end',
      'keep-2',
      '<!-- notes-example:start -->',
      'drop-2',
      '<!-- notes-example:end -->',
      'keep-3',
    ].join('\n');
    expect(stripNotesMarkers(input)).toBe(['keep-1', 'keep-2', 'keep-3'].join('\n'));
  });

  it('无标记文本原样返回', () => {
    const input = 'no markers here\n';
    expect(stripNotesMarkers(input)).toBe(input);
  });

  it('删除块后折叠多余空行（派生项目首跑 lint 不留格式问题）', () => {
    const input = ['a', '', '// notes-example:start', 'drop', '// notes-example:end', '', 'b'].join(
      '\n',
    );
    expect(stripNotesMarkers(input)).toBe(['a', '', 'b'].join('\n'));
  });

  it('标记损坏时显式抛错', () => {
    expect(() => stripNotesMarkers('// notes-example:end')).toThrow(/孤立/);
    expect(() => stripNotesMarkers('// notes-example:start\nx')).toThrow(/未闭合/);
    expect(() =>
      stripNotesMarkers(
        '// notes-example:start\n// notes-example:start\n// notes-example:end\n// notes-example:end',
      ),
    ).toThrow(/嵌套/);
  });
});

describe('countIpcMetaSource', () => {
  it('按 meta 源码统计域、请求与事件通道', () => {
    const counts = countIpcMetaSource(read(REPO_ROOT, 'packages/shared/src/ipc/meta.ts'));
    expect(counts.domains).toBe(14);
    expect(counts.requests).toBe(51);
    expect(counts.events).toBe(5);
    expect(counts.channels).toBe(56);
    expect(counts.domainNames).toContain('notes');
  });
});

describe('removeNotesExample', () => {
  let root: string;

  beforeEach(() => {
    root = createFixture();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('删除示例文件、标记块、i18n 键、脚本与迁移，并同步 IPC 文档', () => {
    const results = removeNotesExample(root, {
      dryRun: false,
      removeMigration: true,
      today: '2026-10-26',
    });

    expect(results.some((result) => result.changed)).toBe(true);
    for (const rel of NOTES_EXAMPLE_PATHS.files) {
      expect(existsSync(join(root, rel))).toBe(false);
    }
    expect(existsSync(join(root, 'src/main/infra/notes'))).toBe(false);

    for (const rel of NOTES_EXAMPLE_PATHS.marked) {
      const text = read(root, rel);
      expect(text).not.toContain('notes-example:');
    }
    expect(read(root, 'packages/shared/src/ipc/meta.ts')).not.toContain('notes:');
    expect(read(root, 'packages/shared/src/ipc/domains/index.ts')).not.toContain('notesDomain');
    expect(read(root, 'src/renderer/lib/constants.ts')).not.toContain('notes');

    for (const locale of ['zh-CN', 'en']) {
      const parsed = JSON.parse(
        read(root, `src/renderer/i18n/locales/${locale}/common.json`),
      ) as Record<string, unknown> & {
        update?: Record<string, unknown>;
        sidebar?: { nav?: Record<string, unknown> };
      };
      expect(parsed).not.toHaveProperty('notes');
      expect(parsed.sidebar?.nav).not.toHaveProperty('notes');
      expect(parsed.update?.['notesTitle']).toBe('更新说明');
    }

    expect(JSON.parse(read(root, 'package.json')).scripts).not.toHaveProperty(
      'remove:notes-example',
    );
    const boundary = JSON.parse(read(root, 'scripts/test-boundary-exempt.json')) as {
      entries: { file: string }[];
    };
    expect(boundary.entries.map((entry) => entry.file)).toEqual([
      'src/main/infra/storage/backup-store.test.ts',
    ]);
    expect(read(root, 'src/renderer/hooks/use-deep-link.ts')).toContain('navigate(ROUTES.home);');
    expect(read(root, 'src/renderer/hooks/use-deep-link.ts')).not.toContain('ROUTES.note');
    expect(read(root, 'src/renderer/components/layout/Sidebar.tsx')).toBe(
      ["import { Settings2 } from 'lucide-react';", 'export { Settings2 };'].join('\n'),
    );
    const mockApi = read(root, 'src/renderer/dev/mock-api.ts');
    expect(mockApi).not.toContain('type Note');
    expect(mockApi).not.toContain('ipcErr');
    expect(mockApi).toContain("import { ipcOk } from '@/lib/ipc-factories';");
    expect(read(root, 'src/renderer/hooks/use-deep-link.test.tsx')).toBe(
      [
        "expect(router.state.location.pathname).toBe('/');",
        "await waitFor(() => expect(router.state.location.pathname).toBe('/'));",
      ].join('\n'),
    );
    expect(read(root, 'e2e/electron-deeplink.spec.ts')).not.toContain('笔记不存在');

    const doc = read(root, 'docs/design/19-ipc-spec.md');
    expect(doc).toContain('2 域 3 channel');
    expect(doc).toContain('共 2 个 request 通道 + 1 个 event 通道');
    expect(doc).toContain('实测 2 个');
    expect(doc).toContain('`app / update`');
    expect(doc).not.toContain('notes');
    expect(doc).toContain('最后同步：2026-10-26');

    const journal = JSON.parse(read(root, 'drizzle/meta/_journal.json')) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((entry) => entry.tag)).toEqual(['0000_init']);
    expect(existsSync(join(root, 'drizzle/0001_lazy_mad_thinker.sql'))).toBe(false);
    expect(existsSync(join(root, 'drizzle/meta/0001_snapshot.json'))).toBe(false);
  });

  it('幂等：第二次执行无改动', () => {
    removeNotesExample(root, { dryRun: false, removeMigration: true });
    expect(removeNotesExample(root, { dryRun: false, removeMigration: true })).toEqual([]);
  });

  it('dry-run 只报告不落盘', () => {
    const before = read(root, 'packages/shared/src/ipc/meta.ts');
    const results = removeNotesExample(root, { dryRun: true, removeMigration: true });

    expect(results.some((result) => result.changed)).toBe(true);
    expect(read(root, 'packages/shared/src/ipc/meta.ts')).toBe(before);
    expect(existsSync(join(root, 'src/main/ipc/notes.handler.ts'))).toBe(true);
    expect(existsSync(join(root, 'drizzle/0001_lazy_mad_thinker.sql'))).toBe(true);
  });

  it('独立移除默认保留迁移与表；--drop-table 注入生成器', () => {
    const generate = vi.fn();
    removeNotesExample(root, {
      dryRun: false,
      removeMigration: false,
      dropTable: true,
      generateDropMigration: generate,
    });

    expect(generate).toHaveBeenCalledWith(root);
    expect(existsSync(join(root, 'drizzle/0001_lazy_mad_thinker.sql'))).toBe(true);
    expect(existsSync(join(root, 'drizzle/meta/0001_snapshot.json'))).toBe(true);
    const journal = JSON.parse(read(root, 'drizzle/meta/_journal.json')) as {
      entries: { tag: string }[];
    };
    expect(journal.entries).toHaveLength(2);
  });

  it('示例不存在时无操作', () => {
    for (const rel of NOTES_EXAMPLE_PATHS.dirs) {
      rmSync(join(root, rel), { recursive: true, force: true });
    }
    for (const rel of NOTES_EXAMPLE_PATHS.files) {
      rmSync(join(root, rel), { force: true });
    }
    for (const rel of NOTES_EXAMPLE_PATHS.marked) {
      writeFileSync(join(root, rel), 'clean\n', 'utf8');
    }
    rmSync(join(root, 'src/renderer/hooks/use-deep-link.ts'), { force: true });
    for (const locale of ['zh-CN', 'en']) {
      write(
        root,
        `src/renderer/i18n/locales/${locale}/common.json`,
        '{\n  "sidebar": {\n    "nav": {}\n  }\n}\n',
      );
    }
    expect(removeNotesExample(root, { dryRun: false, removeMigration: true })).toEqual([]);
  });
});

describe('模板出厂状态', () => {
  it('标记块全部可解析，删除清单文件都存在', () => {
    for (const rel of NOTES_EXAMPLE_PATHS.marked) {
      const text = read(REPO_ROOT, rel);
      expect(text).toContain('notes-example:');
      expect(() => stripNotesMarkers(text)).not.toThrow();
      expect(stripNotesMarkers(text)).not.toContain('notes-example:');
    }
    for (const rel of NOTES_EXAMPLE_PATHS.files) {
      expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
    }
    for (const rel of NOTES_EXAMPLE_PATHS.dirs) {
      expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
    }
    expect(read(REPO_ROOT, 'package.json')).toContain('"remove:notes-example"');
  });

  it('移除后 IPC 域/通道计数与文档同步器口径一致', () => {
    const afterRemoval = countIpcMetaSource(
      stripNotesMarkers(read(REPO_ROOT, 'packages/shared/src/ipc/meta.ts')),
    );
    expect(afterRemoval.domains).toBe(13);
    expect(afterRemoval.requests).toBe(44);
    expect(afterRemoval.events).toBe(5);
    expect(afterRemoval.domainNames).not.toContain('notes');
  });
});
