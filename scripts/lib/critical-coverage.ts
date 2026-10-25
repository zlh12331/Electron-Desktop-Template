// scripts/lib/critical-coverage.ts
// 关键模块覆盖率规则核：按文件而非全局平均卡关，防止高风险模块被总体数字平均掉。

/** 单个文件的覆盖率统计 */
export interface FileCoverage {
  readonly lines: { readonly covered: number; readonly total: number };
  readonly branches: { readonly covered: number; readonly total: number };
}

/** 关键模块阈值 */
export interface CriticalTarget {
  readonly layer: 'main' | 'renderer' | 'shared';
  readonly file: string;
  readonly lines: number;
  readonly branches: number;
}

/** 关键模块清单：阈值按当前实测留出回归缓冲，只允许随棘轮上调 */
export const CRITICAL_TARGETS: readonly CriticalTarget[] = [
  { layer: 'main', file: 'infra/storage/db.ts', lines: 80, branches: 60 },
  { layer: 'main', file: 'security/csp.ts', lines: 95, branches: 90 },
  { layer: 'main', file: 'deep-link.ts', lines: 90, branches: 85 },
  { layer: 'main', file: 'ipc/wrap.ts', lines: 90, branches: 90 },
  { layer: 'main', file: 'ipc/register.ts', lines: 95, branches: 90 },
  { layer: 'main', file: 'infra/update/update-service.ts', lines: 90, branches: 85 },
  { layer: 'main', file: 'infra/storage/settings-io.ts', lines: 95, branches: 90 },
  { layer: 'main', file: 'infra/network/proxy-applier.ts', lines: 90, branches: 85 },
  { layer: 'main', file: 'infra/storage/keychain.ts', lines: 85, branches: 80 },
  { layer: 'main', file: 'infra/file/user-grants.ts', lines: 90, branches: 85 },
  { layer: 'main', file: 'infra/network/proxy-credentials.ts', lines: 80, branches: 75 },
  { layer: 'renderer', file: 'stores/persistent/settings-store.ts', lines: 90, branches: 85 },
  { layer: 'renderer', file: 'hooks/use-deep-link.ts', lines: 90, branches: 80 },
  { layer: 'renderer', file: 'hooks/use-install-update.ts', lines: 95, branches: 95 },
  { layer: 'renderer', file: 'hooks/use-app-info.ts', lines: 80, branches: 55 },
  {
    layer: 'renderer',
    file: 'components/settings/sections/about/diagnostics-card.tsx',
    lines: 95,
    branches: 75,
  },
  { layer: 'renderer', file: 'lib/ipc.ts', lines: 85, branches: 85 },
  { layer: 'shared', file: 'schemas/settings.ts', lines: 90, branches: 85 },
  { layer: 'shared', file: 'constants/errors.ts', lines: 95, branches: 90 },
];

/** 计算百分比（total=0 视为 100，避免空文件永远失败） */
export function percent(covered: number, total: number): number {
  return total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
}

/**
 * 解析 lcov：每个文件的 DA 行与 BRF/BRH 分支统计（SF 路径反斜杠归一）
 *
 * @param text lcov 文本
 * @param prefix 可选路径前缀（shared 的 lcov 以 src/ 开头）
 */
export function parseLcovCoverage(text: string, prefix?: string): Map<string, FileCoverage> {
  const result = new Map<string, FileCoverage>();
  let current: {
    file: string;
    lineTotal: number;
    lineCovered: number;
    brf: number;
    brh: number;
  } | null = null;
  const flush = (): void => {
    if (current === null) return;
    result.set(current.file, {
      lines: { covered: current.lineCovered, total: current.lineTotal },
      branches: { covered: current.brh, total: current.brf },
    });
    current = null;
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      flush();
      const file = line.slice(3).replaceAll('\\', '/');
      current = {
        file: prefix !== undefined && file.startsWith(prefix) ? file.slice(prefix.length) : file,
        lineTotal: 0,
        lineCovered: 0,
        brf: 0,
        brh: 0,
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('DA:')) {
      const count = Number(line.slice(3).split(',')[1]);
      current.lineTotal += 1;
      if (count > 0) current.lineCovered += 1;
    } else if (line.startsWith('BRF:')) {
      current.brf = Number(line.slice(4));
    } else if (line.startsWith('BRH:')) {
      current.brh = Number(line.slice(4));
    } else if (line === 'end_of_record') {
      flush();
    }
  }
  flush();
  return result;
}

/** 比较关键模块阈值；返回人类可读的问题列表 */
export function evaluateCriticalCoverage(
  coverage: Readonly<Record<'main' | 'renderer' | 'shared', Map<string, FileCoverage>>>,
): string[] {
  const issues: string[] = [];
  for (const target of CRITICAL_TARGETS) {
    const entry = coverage[target.layer].get(target.file);
    if (entry === undefined) {
      issues.push(`${target.layer}/${target.file}: 不在覆盖率报告中`);
      continue;
    }
    const lines = percent(entry.lines.covered, entry.lines.total);
    const branches = percent(entry.branches.covered, entry.branches.total);
    if (lines < target.lines) {
      issues.push(`${target.layer}/${target.file}: 行覆盖 ${lines}% < ${target.lines}%`);
    }
    if (branches < target.branches) {
      issues.push(`${target.layer}/${target.file}: 分支覆盖 ${branches}% < ${target.branches}%`);
    }
  }
  return issues;
}
