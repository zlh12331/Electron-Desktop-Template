// user-grants.ts：用户手动授权读路径登记表——用户经系统对话框亲自选中的文件/目录视为已授权
// 模板版用途：dialog:pickFiles / pickDirectory 选中的路径写入本表，后续任何模块读这些路径
// 无需再次确认。业务层（文件读取 / Agent 工具）可查询 isUserGrantedRead。
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

// 授权条目上限 200：LRU 淘汰最旧（防长期运行无限累积）
const MAX_GRANTS = 200;

// key 为 realpath 规范化后的路径：符号链接/大小写差异不会绕过或重复登记
const grants = new Map<string, number>();

// realpath 解析：授予时目标必须真实存在；相对路径/空串直接拒
function canonicalize(inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0 || !isAbsolute(trimmed)) {
    return null;
  }
  try {
    return realpathSync.native(trimmed);
  } catch {
    return null;
  }
}

/** 登记授权路径（重复登记刷新时间戳保持 LRU 新鲜度）；@returns 实际新增条数 */
export function grantUserReadPaths(paths: readonly string[]): number {
  let added = 0;
  const now = Date.now();
  for (const raw of paths) {
    const canonical = canonicalize(raw);
    if (canonical === null) {
      continue;
    }
    if (!grants.has(canonical)) {
      added += 1;
    }
    grants.delete(canonical);
    grants.set(canonical, now);
  }
  while (grants.size > MAX_GRANTS) {
    const oldest = grants.keys().next();
    if (oldest.done === true) {
      break;
    }
    grants.delete(oldest.value);
  }
  return added;
}

/** 判断路径（或其祖先目录）是否在授权表内；未授权的相对路径一律 false */
export function isUserGrantedRead(inputPath: string): boolean {
  const canonical = canonicalize(inputPath);
  if (canonical === null) {
    return false;
  }
  let cursor: string = canonical;
  for (;;) {
    if (grants.has(cursor)) {
      return true;
    }
    const parent = cursor.replace(/[\\/][^\\/]+$/, '');
    if (parent === cursor || parent.length === 0) {
      return false;
    }
    cursor = parent;
  }
}

/** 清空授权表（测试用；生产不调用） */
export function clearUserReadGrants(): void {
  grants.clear();
}
