// remove-notes-example.ts：从已存在的派生项目中移除 Local Notes 参考切片。
// 与 init:template 的区别：不重写品牌，仅删示例代码；默认保留迁移与 notes 表
// （已运行过的数据库仍持有数据，删迁移文件不会回收），--drop-table 生成一条
// DROP TABLE 迁移（应用下次启动执行，不可恢复）。
// 用法：pnpm remove:notes-example [--dry-run] [--drop-table]

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { removeNotesExample } from './lib/notes-example';
import { parseArgs, rejectPositionals } from './scaffold/lib/args';

/** 仓库根（scripts/ → 根） */
const REPO_ROOT = join(import.meta.dirname, '..');

/** CLI 入口 */
function main(): void {
  const parsed = parseArgs(process.argv.slice(2), ['dry-run', 'drop-table', 'help']);
  rejectPositionals(parsed);
  if (parsed.values.size > 0) {
    throw new Error(`未知参数：${[...parsed.values.keys()].map((key) => `--${key}`).join(', ')}`);
  }
  if (parsed.flags.has('help')) {
    console.log(
      [
        '用法：pnpm remove:notes-example [--dry-run] [--drop-table]',
        '',
        '  默认：删除 Local Notes 代码，保留 notes 表与迁移（已有数据不受影响）',
        '  --drop-table  额外生成 DROP TABLE notes 迁移，应用下次启动时清表（不可恢复）',
        '  --dry-run     只报告将改动的文件',
      ].join('\n'),
    );
    return;
  }

  const dryRun = parsed.flags.has('dry-run');
  const dropTable = parsed.flags.has('drop-table');
  console.log(`[remove-notes-example]${dryRun ? '（dry-run，不落盘）' : ''}`);

  const results = removeNotesExample(REPO_ROOT, {
    dryRun,
    removeMigration: false,
    dropTable,
  });
  const changed = results.filter((result) => result.changed);
  for (const result of changed) {
    console.log(`  ${dryRun ? '将改动' : '已改动'}  ${result.file}`);
  }
  if (changed.length === 0) {
    console.log('  无改动（示例已移除）');
  }
  if (dropTable) {
    console.log(
      dryRun
        ? '  将生成 DROP TABLE notes 迁移（应用下次启动时执行）'
        : '  已生成 DROP TABLE notes 迁移；下次启动应用后 notes 表会被删除',
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error: unknown) {
    console.error(
      `[remove-notes-example] ❌ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
