// notes-example.ts：Local Notes 参考切片的移除器——模板初始化（默认）与
// `pnpm remove:notes-example` 共用同一份「示例触点清单」。
// 为什么需要：示例横跨共享契约 / 主进程 / 渲染层 / i18n / 迁移 / E2E / 文档，
// 手工删除必然漏（漏一个 marker 就留死引用）。标记块负责「整段删除」，
// 显式替换负责「删除后需要回落为通用占位」的少数位置。
// 边界：只处理本模板已知的示例触点；不猜测业务代码，不触碰已有数据库。

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IpcChannelCounts } from './docs-contracts';
import { syncIpcSpecText } from './ipc-spec-sync';

/** 单文件/目录的移除结果（与 init-template 的 RewriteResult 同构） */
export interface NotesExampleResult {
  readonly file: string;
  readonly changed: boolean;
}

/** 移除行为 */
export interface RemoveNotesExampleOptions {
  /** true = 只报告将改动的文件，不落盘 */
  readonly dryRun: boolean;
  /**
   * 删除 notes 迁移链（初始化派生项目时使用）。
   * false = 保留迁移与表：已运行过模板应用的数据库仍持有 notes 表，删迁移文件不会回收它。
   */
  readonly removeMigration: boolean;
  /** 生成一条 DROP TABLE 迁移（显式清表；仅独立移除命令使用） */
  readonly dropTable?: boolean;
  /** 生成迁移的执行器（测试注入；默认 pnpm exec drizzle-kit generate） */
  readonly generateDropMigration?: (root: string) => void;
  /** 文档同步日期（测试注入；默认当天） */
  readonly today?: string;
}

/** 整个目录删除（目录内的文件不逐个报告） */
const DELETE_DIRS = ['src/main/infra/notes', 'src/renderer/components/notes'] as const;

/** 单文件删除 */
const DELETE_FILES = [
  'packages/shared/src/schemas/notes.ts',
  'packages/shared/src/ipc/domains/notes.ts',
  'packages/shared/src/__tests__/notes-schemas.test.ts',
  'src/main/infra/storage/tables/notes.ts',
  'src/main/ipc/notes.handler.ts',
  'src/main/ipc/notes.handler.test.ts',
  'src/renderer/components/ui/textarea.tsx',
  'src/renderer/hooks/use-notes.ts',
  'src/renderer/hooks/use-notes.test.tsx',
  'src/renderer/routes/notes.tsx',
  'e2e/notes.spec.ts',
  'docs/design/notes-example.md',
  'scripts/remove-notes-example.ts',
  'scripts/lib/notes-example.test.ts',
] as const;

/** 含 `notes-example:start/end` 标记的文件（整段删除） */
const MARKED_FILES = [
  'packages/shared/src/ipc/meta.ts',
  'packages/shared/src/ipc/domains/index.ts',
  'packages/shared/src/main.ts',
  'packages/shared/src/renderer.ts',
  'packages/shared/src/schemas/invalidation.ts',
  'src/main/index.ts',
  'src/main/infra/storage/schema.ts',
  'src/renderer/dev/mock-api.ts',
  'src/renderer/lib/constants.ts',
  'src/renderer/router.tsx',
  'src/renderer/components/layout/Sidebar.tsx',
  'src/renderer/hooks/use-deep-link.test.tsx',
  'e2e/electron.spec.ts',
  'e2e/a11y.spec.ts',
  'docs/design/19-ipc-spec.md',
  'docs/design/21-state-management-spec.md',
  'docs/design/README.md',
  'docs/README.md',
  'docs/guides/template-acceptance.md',
  'README.md',
  'AGENTS.md',
  'scripts/init-template.test.ts',
] as const;

/** i18n 资源：删除 notes 命名空间与侧栏入口 */
const LOCALE_FILES = [
  'src/renderer/i18n/locales/zh-CN/common.json',
  'src/renderer/i18n/locales/en/common.json',
] as const;

/** 示例触点清单（测试用于核对模板与移除器一致） */
export const NOTES_EXAMPLE_PATHS = {
  /** 整目录删除 */
  dirs: DELETE_DIRS,
  /** 单文件删除 */
  files: DELETE_FILES,
  /** 标记块删除 */
  marked: MARKED_FILES,
} as const;

/** 标记文件集合（O(1) 判定；替换阶段据此跳过没有标记的普通文件） */
const MARKED_FILE_SET = new Set<string>(MARKED_FILES);

/** 标记行（支持 `//` 与 HTML 注释） */
const MARKER_RE = /^\s*(?:\/\/|<!--)\s*notes-example:(start|end)\s*(?:-->)?\s*$/;

/** 需要「替换为通用占位」而非整段删除的文件 */
interface ReplacementFile {
  readonly file: string;
  readonly pairs: readonly (readonly [find: string, replace: string])[];
}

/**
 * 删除示例后需要回落为通用行为的位置
 *
 * 这些位置不能整行删：深链必须继续有目标（关于页占位），测试也必须继续有断言。
 */
const REPLACEMENT_FILES: readonly ReplacementFile[] = [
  {
    file: 'src/renderer/hooks/use-deep-link.ts',
    pairs: [
      [
        ' * 收到协议唤起时导航到目标页面。示例切片把 payload.targetId 解析为笔记 id，\n' +
          ' * 直接打开 `/notes/<id>`（目标不存在时页面显示「笔记不存在」）。\n',
        ' * 收到协议唤起时导航到目标页面。模板版只演示「如何消费深链 payload」：\n' +
          ' * payload.targetId 非空时跳转到关于页作为占位（目标实体不存在时留驻当前页）。\n',
      ],
      [
        '      // 深链示例：targetId 视作笔记 id，打开参考切片的详情页\n' +
          '      navigate(ROUTES.note(payload.targetId));',
        '      // 深链示例：targetId 视作目标实体 id，模板内跳转到关于页作为占位\n' +
          '      navigate(ROUTES.about);',
      ],
    ],
  },
  {
    file: 'src/renderer/hooks/use-deep-link.test.tsx',
    pairs: [
      [
        "expect(router.state.location.pathname).toBe('/notes/abc');",
        "expect(router.state.location.pathname).toBe('/about');",
      ],
      [
        "await waitFor(() => expect(router.state.location.pathname).toBe('/notes/cold'));",
        "await waitFor(() => expect(router.state.location.pathname).toBe('/about'));",
      ],
    ],
  },
  {
    file: 'e2e/electron-deeplink.spec.ts',
    pairs: [
      [
        'await expect(page).toHaveURL(/#\\/notes\\/e2e-deep-link$/, { timeout: 15_000 });',
        'await expect(page).toHaveURL(/#\\/about$/, { timeout: 15_000 });',
      ],
      ["\n    await expect(page.getByText('笔记不存在')).toBeVisible();", ''],
    ],
  },
  {
    file: 'src/renderer/components/layout/Sidebar.tsx',
    pairs: [
      [
        "import { Info, NotebookPen, Settings2 } from 'lucide-react';",
        "import { Info, Settings2 } from 'lucide-react';",
      ],
    ],
  },
  {
    file: 'src/renderer/dev/mock-api.ts',
    pairs: [
      [
        '  type IpcApi,\n  type Note,\n  type UpdateStatusPayload,',
        '  type IpcApi,\n  type UpdateStatusPayload,',
      ],
      [
        "import { ipcErr, ipcOk } from '@/lib/ipc-factories';",
        "import { ipcOk } from '@/lib/ipc-factories';",
      ],
    ],
  },
];

/**
 * 删除标记块（含标记行本身）
 *
 * @throws Error 标记嵌套、孤立 end 或未闭合 start——模板标记坏了必须显式失败，
 * 静默跳过会把「示例没删干净」带进派生项目
 */
export function stripNotesMarkers(text: string): string {
  const output: string[] = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    const match = MARKER_RE.exec(line);
    if (match !== null) {
      inBlock = nextBlockState(inBlock, match[1] === 'start');
      continue;
    }
    if (!inBlock) {
      output.push(line);
    }
  }
  if (inBlock) {
    throw new Error('notes-example 标记未闭合（缺少 end）');
  }
  // 整段删除后两侧空行会叠加成 2+ 空行；归一为单个空行，避免派生项目首跑 lint 即红
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 校验并推进标记块状态（start/end 必须严格配对） */
function nextBlockState(inBlock: boolean, isStart: boolean): boolean {
  if (isStart) {
    if (inBlock) {
      throw new Error('notes-example 标记嵌套（start 内又出现 start）');
    }
    return true;
  }
  if (!inBlock) {
    throw new Error('notes-example 标记孤立（end 前没有 start）');
  }
  return false;
}

/**
 * 从 meta.ts 源码统计域/通道数（移除后不能再 import 模块缓存里的旧表）
 *
 * meta.ts 的域键固定两空格缩进、方法项固定 `request('...')` / `event('...')`；
 * 与 countIpcMeta 的运行时口径一致，供文档同步器复用。
 */
export function countIpcMetaSource(source: string): IpcChannelCounts {
  const domainNames: string[] = [];
  let requests = 0;
  let events = 0;
  for (const line of source.split('\n')) {
    const domain = /^ {2}([A-Za-z][A-Za-z0-9]*): \{\s*$/.exec(line);
    if (domain?.[1] !== undefined) {
      domainNames.push(domain[1]);
    }
    const method = /^\s+[A-Za-z][A-Za-z0-9]*: (request|event)\('/.exec(line);
    if (method?.[1] === 'request') {
      requests += 1;
    } else if (method?.[1] === 'event') {
      events += 1;
    }
  }
  return {
    domains: domainNames.length,
    requests,
    events,
    channels: requests + events,
    domainNames,
  };
}

/**
 * 深链回落到关于页占位（示例存在时 REQUIRED，已移除时保留为 no-op）
 *
 * @param text 文件全文
 * @param find 示例版本片段
 * @param replace 回落版本片段
 * @param required true = 片段缺失即抛错（防止模板漂移后静默留下死引用）
 */
function replaceExact(text: string, find: string, replace: string, required: boolean): string {
  if (!text.includes(find)) {
    if (required) {
      throw new Error(`示例移除失败：未找到待替换片段「${find.split('\n')[0] ?? find}」`);
    }
    return text;
  }
  return text.replace(find, replace);
}

/** 应用回落替换（文件不存在时跳过；片段缺失即抛错，防模板漂移后留下死引用） */
function applyReplacements(root: string, dryRun: boolean): NotesExampleResult[] {
  const results: NotesExampleResult[] = [];
  for (const { file, pairs } of REPLACEMENT_FILES) {
    const current = readIfExists(root, file);
    if (current === null) {
      continue;
    }
    // 同时含标记块的文件：没有标记说明示例已不在（测试夹具的占位文件），跳过替换
    if (MARKED_FILE_SET.has(file) && !current.includes('notes-example:')) {
      continue;
    }
    let next = current;
    for (const [find, replace] of pairs) {
      next = replaceExact(next, find, replace, true);
    }
    results.push(writeIfChanged(root, file, next, dryRun));
  }
  return results;
}

/** 读文件（不存在返回 null） */
function readIfExists(root: string, rel: string): string | null {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** 写文件（内容未变不落盘） */
function writeIfChanged(
  root: string,
  rel: string,
  next: string,
  dryRun: boolean,
): NotesExampleResult {
  const current = readIfExists(root, rel);
  if (current === next) {
    return { file: rel, changed: false };
  }
  if (!dryRun) {
    writeFileSync(join(root, rel), next, 'utf8');
  }
  return { file: rel, changed: true };
}

/** 删除文件或目录（不存在时 changed=false） */
function removePath(root: string, rel: string, dryRun: boolean): NotesExampleResult {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    return { file: rel, changed: false };
  }
  if (!dryRun) {
    rmSync(abs, { recursive: true, force: true });
  }
  return { file: rel, changed: true };
}

/** 示例是否还在（决定后续替换是否必须命中） */
function isExamplePresent(root: string): boolean {
  if (DELETE_DIRS.some((rel) => existsSync(join(root, rel)))) {
    return true;
  }
  if (DELETE_FILES.some((rel) => existsSync(join(root, rel)))) {
    return true;
  }
  for (const rel of MARKED_FILES) {
    const text = readIfExists(root, rel);
    if (text?.includes('notes-example:')) {
      return true;
    }
  }
  const deepLink = readIfExists(root, 'src/renderer/hooks/use-deep-link.ts');
  if (deepLink?.includes('ROUTES.note(')) {
    return true;
  }
  for (const rel of LOCALE_FILES) {
    const text = readIfExists(root, rel);
    if (text?.includes('"notes"')) {
      return true;
    }
  }
  return false;
}

/** 删除 i18n 的 notes 命名空间与侧栏入口（结构化编辑，避免破坏 JSON） */
function removeLocaleKeys(root: string, rel: string, dryRun: boolean): NotesExampleResult {
  const current = readIfExists(root, rel);
  if (current === null) {
    return { file: rel, changed: false };
  }
  const parsed = JSON.parse(current) as {
    notes?: unknown;
    sidebar?: { nav?: Record<string, unknown> };
  };
  if (parsed.notes === undefined && parsed.sidebar?.nav?.['notes'] === undefined) {
    return { file: rel, changed: false };
  }
  delete parsed.notes;
  if (parsed.sidebar?.nav !== undefined) {
    delete parsed.sidebar.nav['notes'];
  }
  return writeIfChanged(root, rel, `${JSON.stringify(parsed, null, 2)}\n`, dryRun);
}

/** 移除准集成测试登记（notes 仓储测试随示例删除） */
function removeTestBoundaryEntry(root: string, dryRun: boolean): NotesExampleResult {
  const rel = 'scripts/test-boundary-exempt.json';
  const current = readIfExists(root, rel);
  if (current === null) {
    return { file: rel, changed: false };
  }
  const parsed = JSON.parse(current) as { entries?: { file?: unknown }[] };
  if (parsed.entries === undefined) {
    return { file: rel, changed: false };
  }
  const kept = parsed.entries.filter(
    (entry) => entry.file !== 'src/main/infra/notes/notes-repository.test.ts',
  );
  if (kept.length === parsed.entries.length) {
    return { file: rel, changed: false };
  }
  parsed.entries = kept;
  return writeIfChanged(root, rel, `${JSON.stringify(parsed, null, 2)}\n`, dryRun);
}

/** 移除 package.json 里的 remove:notes-example 脚本（CLI 文件随后删除） */
function removePackageScript(root: string, dryRun: boolean): NotesExampleResult {
  const rel = 'package.json';
  const current = readIfExists(root, rel);
  if (current === null) {
    return { file: rel, changed: false };
  }
  const parsed = JSON.parse(current) as { scripts?: Record<string, string> };
  if (parsed.scripts?.['remove:notes-example'] === undefined) {
    return { file: rel, changed: false };
  }
  delete parsed.scripts['remove:notes-example'];
  return writeIfChanged(root, rel, `${JSON.stringify(parsed, null, 2)}\n`, dryRun);
}

/** 删除迁移链（初始化专用；已有数据库保留表，但迁移文件缺失不会破坏启动） */
function removeMigrationChain(root: string, dryRun: boolean): NotesExampleResult[] {
  const journalRel = 'drizzle/meta/_journal.json';
  const journalText = readIfExists(root, journalRel);
  if (journalText === null) {
    return [];
  }
  const journal = JSON.parse(journalText) as { entries: { tag?: unknown }[] };
  const tag = journal.entries.find(
    (entry) => typeof entry.tag === 'string' && entry.tag.startsWith('0001_'),
  )?.tag;
  if (typeof tag !== 'string') {
    return [];
  }
  const results: NotesExampleResult[] = [];
  const migrationRel = `drizzle/${tag}.sql`;
  const snapshotRel = 'drizzle/meta/0001_snapshot.json';
  results.push(removePath(root, migrationRel, dryRun), removePath(root, snapshotRel, dryRun));

  journal.entries = journal.entries.filter((entry) => entry.tag !== tag);
  results.push(writeIfChanged(root, journalRel, `${JSON.stringify(journal, null, 2)}\n`, dryRun));
  return results;
}

/** 默认的 DROP 迁移生成器：schema 已去掉 notes，drizzle-kit 会生成 DROP TABLE */
function runDrizzleGenerate(root: string): void {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(
    command,
    ['exec', 'drizzle-kit', 'generate', '--name', 'drop_notes_example'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`drizzle-kit generate 失败（无法生成 DROP TABLE notes 迁移）：${detail}`);
  }
}

/** 同步 IPC 文档的计数、域清单与同步日期 */
function syncIpcDocs(root: string, today: string, dryRun: boolean): NotesExampleResult | null {
  const docRel = 'docs/design/19-ipc-spec.md';
  const doc = readIfExists(root, docRel);
  const meta = readIfExists(root, 'packages/shared/src/ipc/meta.ts');
  if (doc === null || meta === null) {
    return null;
  }
  const withoutNotesSchema = replaceExact(
    doc,
    'invalidation / notes / proxy',
    'invalidation / proxy',
    true,
  );
  const next = syncIpcSpecText(withoutNotesSchema, countIpcMetaSource(meta), {
    updatedAt: today,
    file: docRel,
  });
  return writeIfChanged(root, docRel, next, dryRun);
}

/** 今天（YYYY-MM-DD，UTC） */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 移除 Local Notes 参考切片
 *
 * @param root 仓库根（测试注入临时副本）
 * @param options 行为选项
 * @returns 每个文件/目录的结果（changed 标记是否有实际差异）
 */
export function removeNotesExample(
  root: string,
  options: RemoveNotesExampleOptions,
): NotesExampleResult[] {
  const present = isExamplePresent(root);
  if (!present) {
    return [];
  }
  const { dryRun } = options;
  const results: NotesExampleResult[] = [];

  // 替换先于标记删除：两者作用于不同片段，先行可在标记仍在时判断文件是否属于示例
  results.push(...applyReplacements(root, dryRun));

  for (const rel of MARKED_FILES) {
    const current = readIfExists(root, rel);
    if (current === null) {
      results.push({ file: rel, changed: false });
      continue;
    }
    results.push(writeIfChanged(root, rel, stripNotesMarkers(current), dryRun));
  }

  for (const rel of LOCALE_FILES) {
    results.push(removeLocaleKeys(root, rel, dryRun));
  }
  results.push(removePackageScript(root, dryRun), removeTestBoundaryEntry(root, dryRun));

  const doc = syncIpcDocs(root, options.today ?? today(), dryRun);
  if (doc !== null) {
    results.push(doc);
  }

  // 清表迁移必须在 schema 已去掉 notes 之后、删除示例文件之前生成：
  // 生成失败时示例文件仍在，修好 drizzle 配置后可重跑，不会留下半删状态。
  if (options.dropTable === true && !dryRun) {
    (options.generateDropMigration ?? runDrizzleGenerate)(root);
  }
  if (options.removeMigration) {
    results.push(...removeMigrationChain(root, dryRun));
  }

  for (const rel of DELETE_DIRS) {
    results.push(removePath(root, rel, dryRun));
  }
  for (const rel of DELETE_FILES) {
    results.push(removePath(root, rel, dryRun));
  }

  return results;
}
