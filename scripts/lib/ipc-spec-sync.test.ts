import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_META } from '@code-agent/shared/ipc/meta';
import { describe, expect, it } from 'vitest';

import { checkIpcSpec, countIpcMeta, type IpcChannelCounts } from './docs-contracts';
import { syncIpcSpecText } from './ipc-spec-sync';

const counts: IpcChannelCounts = {
  domains: 3,
  requests: 3,
  events: 1,
  channels: 4,
  domainNames: ['app', 'update', 'notes'],
};

const source = [
  '> 最后同步：2026-10-24（2 域 3 channel = 2 request + 1 event，按 meta.ts 实测）',
  '',
  '域清单（IPC_META / registerIpcHandlers 中，实测 2 个）：',
  '`app / update`。',
  '共 2 个 request 通道 + 1 个 event 通道（2026-10-24 实测）；方法数以 meta.ts 为唯一真源。',
].join('\n');

describe('syncIpcSpecText', () => {
  it('同步计数、域清单与日期后通过文档契约', () => {
    const next = syncIpcSpecText(source, counts, { updatedAt: '2026-10-26' });

    expect(next).toContain('3 域 4 channel = 3 request + 1 event');
    expect(next).toContain('实测 3 个');
    expect(next).toContain('`app / update / notes`');
    expect(next).toContain('共 3 个 request 通道 + 1 个 event 通道');
    expect(next).toContain('最后同步：2026-10-26');
    expect(next).toContain('2026-10-26 实测');
    expect(checkIpcSpec(next, 'spec.md', counts)).toEqual([]);
  });

  it('event-only 新增时只增加 event 通道', () => {
    const eventCounts: IpcChannelCounts = {
      domains: 3,
      requests: 2,
      events: 2,
      channels: 4,
      domainNames: ['app', 'update', 'events'],
    };
    const next = syncIpcSpecText(source, eventCounts, {
      updatedAt: '2026-10-26',
      file: 'spec.md',
    });

    expect(next).toContain('3 域 4 channel = 2 request + 2 event');
    expect(next).toContain('共 2 个 request 通道 + 2 个 event 通道');
    expect(checkIpcSpec(next, 'spec.md', eventCounts)).toEqual([]);
  });

  it('缺少计数声明时 fail-fast', () => {
    expect(() => syncIpcSpecText('无计数', counts, { updatedAt: '2026-10-26' })).toThrow(
      /缺少「N 域 M channel」计数/,
    );
  });

  it('缺少域清单时 fail-fast', () => {
    const withoutList = source.replace('`app / update`。', '');
    expect(() =>
      syncIpcSpecText(withoutList, counts, { updatedAt: '2026-10-26', file: 'spec.md' }),
    ).toThrow(/缺少「域清单」行/);
  });

  it('同一计数重复同步保持稳定', () => {
    const once = syncIpcSpecText(source, counts, { updatedAt: '2026-10-26' });
    const twice = syncIpcSpecText(once, counts, { updatedAt: '2026-10-26' });
    expect(twice).toBe(once);
  });

  it('真实 IPC 规范可同步并通过文档契约', () => {
    const realCounts = countIpcMeta(IPC_META);
    const realText = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs/design/19-ipc-spec.md'),
      'utf8',
    );
    const next = syncIpcSpecText(realText, realCounts, { updatedAt: '2026-10-26' });

    expect(next).toContain(`${realCounts.domains} 域 ${realCounts.channels} channel`);
    expect(checkIpcSpec(next, 'spec.md', realCounts)).toEqual([]);
  });
});
