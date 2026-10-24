// scripts/lib/docs-contracts.ts
// 文档契约规则核（纯函数层）：把「文档里可机器判定的承诺」变成门禁——
// IPC 域/通道计数与域清单、README 静态门禁数量、ErrorCode 符号引用、代码路径引用。
// 边界：不尝试编译任意 Markdown 片段（大量示例是示意性伪代码）；TSDoc 语法由 check:docs
// 负责，请求/响应契约由 IPC 定义表与类型系统负责。规则核可单测，CLI 只做收集与退出码。

/** 一处文档契约问题（file 为调用方给定的展示用相对路径） */
export interface DocsContractIssue {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly detail: string;
}

/** IPC 元数据的最小形状（避免脚本依赖 zod 定义表） */
export interface IpcMetaLike {
  readonly [domain: string]: {
    readonly [method: string]: { readonly kind: 'request' | 'event' };
  };
}

/** IPC 契约计数（域 + 请求/事件通道） */
export interface IpcChannelCounts {
  readonly domains: number;
  readonly requests: number;
  readonly events: number;
  readonly channels: number;
  readonly domainNames: readonly string[];
}

/**
 * 从 IPC 元数据表统计域名与通道数
 *
 * @param meta IPC_META 形状的纯字符串元数据表
 * @returns 域数、request/event 数与域名单
 */
export function countIpcMeta(meta: IpcMetaLike): IpcChannelCounts {
  let requests = 0;
  let events = 0;
  const domainNames: string[] = [];
  for (const [domain, methods] of Object.entries(meta)) {
    domainNames.push(domain);
    for (const def of Object.values(methods)) {
      if (def.kind === 'request') requests += 1;
      else events += 1;
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

/** 文本偏移量 → 1 起始行号 */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/**
 * 校验 IPC 规范中的域/通道计数与域清单
 *
 * @param text 文档全文
 * @param file 展示用相对路径
 * @param counts 当前 IPC_META 统计值
 * @returns 问题列表（空数组 = 通过）
 */
export function checkIpcSpec(
  text: string,
  file: string,
  counts: IpcChannelCounts,
): DocsContractIssue[] {
  const issues: DocsContractIssue[] = [];
  const countPattern = /(\d+)\s*域\s*(\d+)\s*channel/g;
  let countMatches = 0;
  for (const match of text.matchAll(countPattern)) {
    countMatches += 1;
    const domains = Number(match[1]);
    const channels = Number(match[2]);
    if (domains !== counts.domains || channels !== counts.channels) {
      issues.push({
        file,
        line: lineOf(text, match.index ?? 0),
        rule: 'ipc-counts',
        detail: `文档写 ${domains} 域 ${channels} channel，实际 ${counts.domains} 域 ${counts.channels} channel（request ${counts.requests} + event ${counts.events}）`,
      });
    }
  }
  if (countMatches === 0) {
    issues.push({
      file,
      line: 1,
      rule: 'ipc-counts',
      detail: '未找到「N 域 M channel」计数声明（文档契约无法校验）',
    });
  }

  const reqEventPattern = /共\s*(\d+)\s*个\s*request\s*通道\s*\+\s*(\d+)\s*个\s*event\s*通道/g;
  let reqEventMatches = 0;
  for (const match of text.matchAll(reqEventPattern)) {
    reqEventMatches += 1;
    const requests = Number(match[1]);
    const events = Number(match[2]);
    if (requests !== counts.requests || events !== counts.events) {
      issues.push({
        file,
        line: lineOf(text, match.index ?? 0),
        rule: 'ipc-counts',
        detail: `文档写 ${requests} request + ${events} event，实际 ${counts.requests} request + ${counts.events} event`,
      });
    }
  }
  if (reqEventMatches === 0) {
    issues.push({
      file,
      line: 1,
      rule: 'ipc-counts',
      detail: '未找到「N 个 request 通道 + M 个 event 通道」计数声明（文档契约无法校验）',
    });
  }

  const domainListMatch = /域清单[^\n]*\n\s*`([^`]+)`/.exec(text);
  if (domainListMatch === null) {
    issues.push({
      file,
      line: 1,
      rule: 'ipc-domain-list',
      detail: '未找到「域清单」行（应列出全部 IPC 域）',
    });
    return issues;
  }
  const listed = (domainListMatch[1] ?? '')
    .split(/\s*\/\s*/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (!sameStringSet(listed, counts.domainNames)) {
    issues.push({
      file,
      line: lineOf(text, domainListMatch.index),
      rule: 'ipc-domain-list',
      detail: `域清单与 IPC_META 不一致：文档 [${listed.join(', ')}]，实际 [${counts.domainNames.join(', ')}]`,
    });
  }
  return issues;
}

/** 两个字符串数组是否集合相等（忽略顺序，重复项视为不相等） */
function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false;
  return [...leftSet].every((name) => rightSet.has(name));
}

/**
 * 校验 README/AGENTS 中「N 项静态审计」与 check:static 实际命令数一致
 *
 * @param text 文档全文
 * @param file 展示用相对路径
 * @param actualCount check:static 链中的实际命令数
 * @returns 问题列表（空数组 = 通过）
 */
export function checkGateCount(
  text: string,
  file: string,
  actualCount: number,
): DocsContractIssue[] {
  const issues: DocsContractIssue[] = [];
  const pattern = /(?:(\d+)\s*项静态审计|静态审计\s*(\d+)\s*项)/g;
  let matches = 0;
  for (const match of text.matchAll(pattern)) {
    matches += 1;
    const documented = Number(match[1] ?? match[2]);
    if (documented !== actualCount) {
      issues.push({
        file,
        line: lineOf(text, match.index ?? 0),
        rule: 'static-gate-count',
        detail: `文档写 ${documented} 项静态审计，实际 check:static 链为 ${actualCount} 项`,
      });
    }
  }
  if (matches === 0) {
    issues.push({
      file,
      line: 1,
      rule: 'static-gate-count',
      detail: '未找到「N 项静态审计」计数声明（文档契约无法校验）',
    });
  }
  return issues;
}

/**
 * 校验文本中 `ErrorCode.<KEY>` 引用是否存在于当前错误码表
 *
 * @param text 文档或源码全文
 * @param file 展示用相对路径
 * @param codes 当前 ErrorCode 键集合
 * @returns 问题列表（空数组 = 通过）
 */
export function checkErrorCodeRefs(
  text: string,
  file: string,
  codes: ReadonlySet<string>,
): DocsContractIssue[] {
  const issues: DocsContractIssue[] = [];
  const pattern = /\bErrorCode\.([A-Z][A-Z0-9_]*)/g;
  for (const match of text.matchAll(pattern)) {
    const code = match[1];
    if (code === undefined || codes.has(code)) continue;
    issues.push({
      file,
      line: lineOf(text, match.index ?? 0),
      rule: 'error-code-ref',
      detail: `ErrorCode.${code} 不在当前错误码表中（示例/注释已过期）`,
    });
  }
  return issues;
}

/** 路径引用检查的扩展名白名单（只查源码/配置/文档文件，不查目录与 URL） */
const PATH_PATTERN =
  /(?<![\w./-])((?:src|packages|scripts|e2e|tests|docs|observability|resources|drizzle)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|json|md|css|yml|yaml|nsh|py|html))(?![\w/.-])/g;

/** 示意性路径豁免：模板文档常用这些占位符，不是真实文件引用 */
function isPlaceholderPath(path: string): boolean {
  if (path.includes('...')) return true;
  if (/(?:^|\/)(?:your|example|sample|placeholder)[-_]/i.test(path)) return true;
  return /(?:^|\/)xxx(?:[./]|$)/i.test(path);
}

/**
 * 校验文本中的代码路径引用是否存在
 *
 * @param text 文档或源码全文
 * @param file 展示用相对路径
 * @param exists 相对仓库根的路径存在性判断
 * @returns 问题列表（空数组 = 通过）
 */
export function checkPathRefs(
  text: string,
  file: string,
  exists: (relativePath: string) => boolean,
): DocsContractIssue[] {
  const issues: DocsContractIssue[] = [];
  for (const match of text.matchAll(PATH_PATTERN)) {
    const path = match[1];
    if (path === undefined || isPlaceholderPath(path) || exists(path)) continue;
    issues.push({
      file,
      line: lineOf(text, match.index ?? 0),
      rule: 'stale-path-ref',
      detail: `路径引用不存在：${path}`,
    });
  }
  return issues;
}
