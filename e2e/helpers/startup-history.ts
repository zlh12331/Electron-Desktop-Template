// startup-history.ts：生产启动分段耗时趋势记录（stats/ 为本地/CI 产物，不入仓）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HISTORY_PATH = join(ROOT, 'stats', 'startup-history.json');
const MAX_SAMPLES = 30;

/** 一次生产启动的分段耗时（毫秒） */
export interface StartupMeasurement {
  readonly launchMs: number;
  readonly firstWindowMs: number;
  readonly domMs: number;
  readonly firstPaintMs: number;
  readonly interactiveMs: number;
  readonly totalMs: number;
}

interface StartupHistoryEntry extends StartupMeasurement {
  readonly timestamp: string;
}

/** 趋势对比结果：无历史样本时 deltaPct 为 null */
export interface StartupTrend {
  readonly samples: number;
  readonly deltaPct: number | null;
}

function readHistory(): StartupHistoryEntry[] {
  if (!existsSync(HISTORY_PATH)) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    return Array.isArray(parsed) ? (parsed as StartupHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * 记录本次启动耗时，保留最近 30 次，并返回相对上一条样本的变化百分比
 *
 * @param measurement 本次分段耗时
 * @returns 历史样本数与环比变化（首条记录为 null）
 */
export function recordStartupMeasurement(measurement: StartupMeasurement): StartupTrend {
  const history = readHistory();
  const previous = history.at(-1);
  const next = [...history, { ...measurement, timestamp: new Date().toISOString() }].slice(
    -MAX_SAMPLES,
  );
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  writeFileSync(HISTORY_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    samples: next.length,
    deltaPct:
      previous === undefined
        ? null
        : Math.round(((measurement.totalMs - previous.totalMs) / previous.totalMs) * 1000) / 10,
  };
}
