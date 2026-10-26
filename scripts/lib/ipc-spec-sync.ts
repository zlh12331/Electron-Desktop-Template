// ipc-spec-sync.ts：scaffold:ipc 的文档同步器——把 IPC_META 的域/通道计数与域清单
// 写回 docs/design/19-ipc-spec.md，并用 check:docs-contracts 同一规则做自校验。
// 边界：只改可机器判定的计数、域清单与同步日期；规范正文由维护者手写。

import { checkIpcSpec, type IpcChannelCounts } from './docs-contracts';

const DEFAULT_FILE = 'docs/design/19-ipc-spec.md';

/** 文档同步选项 */
export interface IpcSpecSyncOptions {
  /** 写入「最后同步」与「实测」日期（YYYY-MM-DD） */
  readonly updatedAt: string;
  /** 展示用文件路径（测试注入；默认 IPC 规范路径） */
  readonly file?: string;
}

/** 缺少可更新结构时 fail-fast：文档契约会红，继续脚手架只会制造双份漂移 */
function requireCount(matches: number, label: string, file: string): void {
  if (matches === 0) {
    throw new Error(`${file} 缺少${label}，无法自动同步 IPC 契约`);
  }
}

/**
 * 同步 IPC 规范中的计数、域清单与日期
 *
 * @param text 当前规范全文
 * @param counts 目标 IPC 计数（应来自 IPC_META + 本次新增条目）
 * @param options 同步选项
 * @returns 同步后的规范全文
 * @throws Error 规范缺少可判定结构，或同步后仍不符合文档契约
 */
export function syncIpcSpecText(
  text: string,
  counts: IpcChannelCounts,
  options: IpcSpecSyncOptions,
): string {
  const file = options.file ?? DEFAULT_FILE;

  let domainChannelMatches = 0;
  let next = text.replace(/(\d+)\s*域\s*(\d+)\s*channel/g, () => {
    domainChannelMatches += 1;
    return `${counts.domains} 域 ${counts.channels} channel`;
  });
  requireCount(domainChannelMatches, '「N 域 M channel」计数', file);

  let reqEventMatches = 0;
  next = next.replace(
    /(共\s*)(\d+)(\s*个\s*request\s*通道\s*\+\s*)(\d+)(\s*个\s*event\s*通道)/g,
    (_match, prefix: string, _request: string, middle: string, _event: string, suffix: string) => {
      reqEventMatches += 1;
      return `${prefix}${counts.requests}${middle}${counts.events}${suffix}`;
    },
  );
  requireCount(reqEventMatches, '「共 N 个 request 通道 + M 个 event 通道」计数', file);

  // 顶部摘要使用「= N request + M event」；没有该形态时不影响契约校验
  next = next.replace(
    /(=\s*)(\d+)(\s*request\s*\+\s*)(\d+)(\s*event)/g,
    (_match, prefix: string, _request: string, middle: string, _event: string, suffix: string) =>
      `${prefix}${counts.requests}${middle}${counts.events}${suffix}`,
  );

  let domainCountMatches = 0;
  next = next.replace(
    /(域清单[^\n]*实测\s*)\d+(\s*个)/g,
    (_match, prefix: string, suffix: string) => {
      domainCountMatches += 1;
      return `${prefix}${counts.domains}${suffix}`;
    },
  );
  requireCount(domainCountMatches, '「域清单…实测 N 个」计数', file);

  let domainListMatches = 0;
  next = next.replace(
    /(域清单[^\n]*\n\s*`)([^`]+)(`)/g,
    (_match, prefix: string, _list: string, suffix: string) => {
      domainListMatches += 1;
      return `${prefix}${counts.domainNames.join(' / ')}${suffix}`;
    },
  );
  requireCount(domainListMatches, '「域清单」行', file);

  next = next
    .replace(/(最后同步：)\d{4}-\d{2}-\d{2}/g, `$1${options.updatedAt}`)
    .replace(/（\d{4}-\d{2}-\d{2}\s*实测）/g, `（${options.updatedAt} 实测）`);

  const issues = checkIpcSpec(next, file, counts);
  if (issues.length > 0) {
    throw new Error(
      `${file} 同步后仍不符合文档契约：${issues
        .map((issue) => `${issue.line}:${issue.detail}`)
        .join('; ')}`,
    );
  }
  return next;
}
