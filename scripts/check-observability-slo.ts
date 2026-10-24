import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OBSERVABILITY_METRIC_DEFINITIONS } from '@code-agent/shared/observability';

import { findMissingSloDocs, validateSloDocument } from './lib/observability-slo';
import type { ObservabilitySloDocument } from './lib/observability-slo-types';

const ROOT = join(import.meta.dirname, '..');
const SLO_PATH = join(ROOT, 'observability', 'slo.json');
const RUNBOOK = join(ROOT, 'docs', 'guides', 'observability-runbook.md');

function main(): number {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(SLO_PATH, 'utf8'));
  } catch (error) {
    console.error(`[check-observability-slo] 无法读取 SLO JSON：${String(error)}`);
    return 1;
  }
  const problems = [...validateSloDocument(raw, OBSERVABILITY_METRIC_DEFINITIONS)];
  if (problems.length === 0) {
    const doc = raw as ObservabilitySloDocument;
    problems.push(...findMissingSloDocs(doc, readFileSync(RUNBOOK, 'utf8')));
    if (problems.length === 0) {
      console.log(
        `[check-observability-slo] 通过：${doc.slos.length} 条 SLO、${doc.alerts.length} 条独立告警契约合法且运行手册已覆盖（不代表后端已部署）`,
      );
      return 0;
    }
  }
  console.error(`[check-observability-slo] ${problems.length} 处问题：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}

process.exit(main());
