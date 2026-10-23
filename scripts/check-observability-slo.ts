// check-observability-slo.ts：SLO 定义门禁——结构合法、指标名已注册、运行手册覆盖全部 id
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OBSERVABILITY_METRIC_NAMES } from '@code-agent/shared/observability';

import { findMissingSloDocs, validateSloDocument } from './lib/observability-slo';
import type { ObservabilitySloDocument } from './lib/observability-slo-types';

const ROOT = join(import.meta.dirname, '..');
const SLO_PATH = join(ROOT, 'observability', 'slo.json');
const RUNBOOK = join(ROOT, 'docs', 'guides', 'observability-runbook.md');

function main(): number {
  const doc = JSON.parse(readFileSync(SLO_PATH, 'utf8')) as ObservabilitySloDocument;
  const problems = [
    ...validateSloDocument(doc, new Set(OBSERVABILITY_METRIC_NAMES)),
    ...findMissingSloDocs(doc, readFileSync(RUNBOOK, 'utf8')),
  ];
  if (problems.length > 0) {
    console.error(`[check-observability-slo] ❌ ${problems.length} 处问题：`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `[check-observability-slo] ✅ 通过：${doc.slos.length} 条 SLO 定义合法且运行手册已覆盖`,
  );
  return 0;
}

process.exit(main());
