import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC_META } from '@code-agent/shared/ipc/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkIpcSpec, countIpcMeta } from '../lib/docs-contracts';
import { formatLocalDate, type MethodSpec, nextIpcCounts, runScaffold } from './scaffold-ipc';

const REPO_ROOT = join(import.meta.dirname, '../..');
const DOCS = 'docs/design/19-ipc-spec.md';
const META = 'packages/shared/src/ipc/meta.ts';
const DOMAIN_INDEX = 'packages/shared/src/ipc/domains/index.ts';
const MAIN_INDEX = 'src/main/index.ts';

/** 只复制脚手架会读写的真实文件，保留真实格式（不另造一套模板） */
function createFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-ipc-'));
  for (const rel of [META, DOMAIN_INDEX, MAIN_INDEX, DOCS]) {
    cpSync(join(REPO_ROOT, rel), join(dir, rel), { recursive: true });
  }
  cpSync(
    join(REPO_ROOT, 'packages/shared/src/ipc/domains'),
    join(dir, 'packages/shared/src/ipc/domains'),
    {
      recursive: true,
    },
  );
  mkdirSync(join(dir, 'src/main/ipc'), { recursive: true });
  return dir;
}

function handlerPath(root: string, domain: string): string {
  return join(root, 'src', 'main', 'ipc', `${domain}.handler.ts`);
}

function readDocs(root: string): string {
  return readFileSync(join(root, DOCS), 'utf8');
}

describe('nextIpcCounts', () => {
  const current = countIpcMeta(IPC_META);

  it('新 request 域同时增加域、request 与总通道', () => {
    const next = nextIpcCounts(current, { domain: 'widgets', method: 'create', kind: 'request' });
    expect(next.domains).toBe(current.domains + 1);
    expect(next.requests).toBe(current.requests + 1);
    expect(next.events).toBe(current.events);
    expect(next.channels).toBe(current.channels + 1);
    expect(next.domainNames.at(-1)).toBe('widgets');
  });

  it('已有域只增加对应 kind 与总通道', () => {
    const next = nextIpcCounts(current, {
      domain: 'invalidation',
      method: 'markDirty',
      kind: 'request',
    });
    expect(next.domains).toBe(current.domains);
    expect(next.requests).toBe(current.requests + 1);
    expect(next.domainNames).toEqual(current.domainNames);
  });
});

describe('formatLocalDate', () => {
  it('使用本地日期而非 UTC（本地凌晨不会退到前一天）', () => {
    expect(formatLocalDate(new Date(2026, 0, 2, 0, 30))).toBe('2026-01-02');
  });
});

describe('runScaffold（临时副本，真实格式）', () => {
  let dir: string;
  let spec: MethodSpec;

  beforeEach(() => {
    dir = createFixture();
    spec = { domain: 'widgets', method: 'create', kind: 'request' };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('新 request 域：生成定义/handler/注册，并同步 IPC 规范', () => {
    runScaffold(spec, { root: dir, meta: IPC_META, today: '2026-10-26' });

    const meta = readFileSync(join(dir, META), 'utf8');
    const domainFile = readFileSync(
      join(dir, 'packages', 'shared', 'src', 'ipc', 'domains', 'widgets.ts'),
      'utf8',
    );
    const mainIndex = readFileSync(join(dir, MAIN_INDEX), 'utf8');
    const handler = readFileSync(handlerPath(dir, 'widgets'), 'utf8');
    const expected = nextIpcCounts(countIpcMeta(IPC_META), spec);

    expect(meta).toContain("create: request('widgets:create')");
    expect(domainFile).toContain('withSchema');
    expect(domainFile).toContain('OkResSchema');
    expect(mainIndex).toContain("import { widgetsHandlers } from './ipc/widgets.handler';");
    expect(mainIndex).toContain('widgets: widgetsHandlers,');
    expect(handler).toContain("from './wrap'");
    expect(handler).not.toContain("from '../utils/wrap'");
    expect(checkIpcSpec(readDocs(dir), DOCS, expected)).toEqual([]);
    expect(readDocs(dir)).toContain(`实测 ${expected.domains} 个`);
    expect(readDocs(dir)).toContain('widgets');
  });

  it('新 event 域：不生成/注册 handler，且不引入未使用 OkResSchema', () => {
    const eventSpec: MethodSpec = { domain: 'acceptance', method: 'changed', kind: 'event' };
    runScaffold(eventSpec, { root: dir, meta: IPC_META, today: '2026-10-26' });

    const meta = readFileSync(join(dir, META), 'utf8');
    const domainFile = readFileSync(
      join(dir, 'packages', 'shared', 'src', 'ipc', 'domains', 'acceptance.ts'),
      'utf8',
    );
    const mainIndex = readFileSync(join(dir, MAIN_INDEX), 'utf8');
    const expected = nextIpcCounts(countIpcMeta(IPC_META), eventSpec);

    expect(meta).toContain("changed: event('acceptance:changed')");
    expect(domainFile).toContain('withPayload');
    expect(domainFile).not.toContain('OkResSchema');
    expect(existsSync(handlerPath(dir, 'acceptance'))).toBe(false);
    expect(mainIndex).not.toContain('acceptanceHandlers');
    expect(checkIpcSpec(readDocs(dir), DOCS, expected)).toEqual([]);
  });

  it('原 event-only 域首次加 request：补 handler 并注册', () => {
    const requestSpec: MethodSpec = {
      domain: 'invalidation',
      method: 'markDirty',
      kind: 'request',
    };
    runScaffold(requestSpec, { root: dir, meta: IPC_META, today: '2026-10-26' });

    const mainIndex = readFileSync(join(dir, MAIN_INDEX), 'utf8');
    const handler = readFileSync(handlerPath(dir, 'invalidation'), 'utf8');
    const domainFile = readFileSync(
      join(dir, 'packages', 'shared', 'src', 'ipc', 'domains', 'invalidation.ts'),
      'utf8',
    );
    const expected = nextIpcCounts(countIpcMeta(IPC_META), requestSpec);

    expect(mainIndex).toContain(
      "import { invalidationHandlers } from './ipc/invalidation.handler';",
    );
    expect(mainIndex).toContain('invalidation: invalidationHandlers,');
    expect(handler).toContain("from './wrap'");
    expect(domainFile).toContain('withSchema');
    expect(domainFile).toContain('OkResSchema');
    expect(checkIpcSpec(readDocs(dir), DOCS, expected)).toEqual([]);
  });

  it('重复脚手架 fail-fast，不改动文件', () => {
    runScaffold(spec, { root: dir, meta: IPC_META, today: '2026-10-26' });
    const before = readFileSync(join(dir, META), 'utf8');

    expect(() => runScaffold(spec, { root: dir, meta: IPC_META, today: '2026-10-26' })).toThrow(
      /通道已存在/,
    );
    expect(readFileSync(join(dir, META), 'utf8')).toBe(before);
  });

  it('后续步骤失败时回滚所有已写文件，不留下半成品', () => {
    const metaBefore = readFileSync(join(dir, META), 'utf8');
    const domainIndexBefore = readFileSync(join(dir, DOMAIN_INDEX), 'utf8');
    const docsBefore = readDocs(dir);
    const mainIndexPath = join(dir, MAIN_INDEX);
    const corruptedMainIndex = readFileSync(mainIndexPath, 'utf8').replace(
      'registerIpcHandlers({',
      'registerIpcHandlersMissing({',
    );
    writeFileSync(mainIndexPath, corruptedMainIndex, 'utf8');

    expect(() => runScaffold(spec, { root: dir, meta: IPC_META, today: '2026-10-26' })).toThrow(
      /registerIpcHandlers|未找到调用块/,
    );

    expect(readFileSync(join(dir, META), 'utf8')).toBe(metaBefore);
    expect(readFileSync(join(dir, DOMAIN_INDEX), 'utf8')).toBe(domainIndexBefore);
    expect(readDocs(dir)).toBe(docsBefore);
    expect(readFileSync(mainIndexPath, 'utf8')).toBe(corruptedMainIndex);
    expect(existsSync(handlerPath(dir, 'widgets'))).toBe(false);
    expect(existsSync(join(dir, 'packages/shared/src/ipc/domains/widgets.ts'))).toBe(false);
  });
});
