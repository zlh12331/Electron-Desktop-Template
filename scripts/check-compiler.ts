// scripts/check-compiler.ts
// React Compiler 生效门禁：断言渲染层产物含 react/compiler-runtime 的调用点（useMemoCache 运行时痕迹）。
// 编译器经 electron.vite.config.ts / vite.web.config.ts 的 react({ compiler }) 启用，而 oxc-transform-react
// 是 plugin-react v6 的可选 peerDep——缺失或被移除时 compiler 选项会静默失效（无任何报错），故需机器闸。
// 判据不止"字符串存在"：`compiler-runtime` 路径字符串在 react 包自身被打进的 vendor chunk 里也有，只查
// 字符串会在编译器真失效时仍通过；故统计净调用点与含调用点的 chunk 数（双下限，见 MIN_COMPILER_CHUNK_RATIO）。
// 产物不存在（本地未构建）时仅提示跳过，不卡关；CI 中在 build 之后运行：pnpm build && pnpm check:compiler

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { countCompilerCallSites } from './lib/compiler-output';

// ───── 判据参数：产物位置 + 双下限之一 ─────
const ROOT = join(import.meta.dirname, '..');
const ASSETS_DIR = join(ROOT, 'out', 'renderer', 'assets');

/** 含调用点的 chunk 数下限：按**产物规模**取比例，而非绝对值。
 *
 * 2026-10-22 模板实测 11/20（55%），上游产品线旧值是绝对值 20（当时实测 28/35）——模板化后源码
 * 缩到 109 个文件、产物只剩 20 个 chunk，旧下限必然误报（已发生一次 CI 假红）。比例下限对构建
 * 拆分方式变化免疫：编译器整体失效时该数为 0，由上方 0 分支直接拦；本下限只兜「部分 chunk 退化」
 * 的中间态，40% 相对当前实测留约 27% 余量。 */
const MIN_COMPILER_CHUNK_RATIO = 0.4;

function main(): number {
  let files: string[];
  try {
    files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'));
  } catch {
    console.log('[check-compiler] ⏭️ 无构建产物（out/renderer/assets），跳过（CI 中 build 后生效）');
    return 0;
  }
  if (files.length === 0) {
    console.log('[check-compiler] ⏭️ assets 目录无 .js 产物，跳过（异常构建请检查 build 输出）');
    return 0;
  }

  // 判据核在 lib 纯函数内（应用 chunk 的顶层调用减 vendor 的模块包装定义）
  const { totalCalls, chunksWithCalls } = countCompilerCallSites(
    files.map((f) => readFileSync(join(ASSETS_DIR, f), 'utf8')),
  );

  if (chunksWithCalls === 0) {
    console.error('[check-compiler] ❌ 渲染层产物无 react/compiler-runtime 编译痕迹：');
    console.error('  React Compiler 实际未参与构建（静默失效）——排查顺序：');
    console.error(
      '  1. oxc-transform-react 是否安装（plugin-react v6 可选 peerDep，缺失即静默跳过）',
    );
    console.error(
      '  2. electron.vite.config.ts / vite.web.config.ts 的 react({ compiler: ... }) 是否还在',
    );
    console.error('  3. pnpm build 日志中应出现 "vite:react-compiler transform" 插件调用计时');
    return 1;
  }
  const minChunks = Math.ceil(files.length * MIN_COMPILER_CHUNK_RATIO);
  if (chunksWithCalls < minChunks) {
    console.error(
      `[check-compiler] ❌ 含编译器调用点的 chunk 仅 ${chunksWithCalls} 个（下限 ${minChunks} = 产物 ${files.length} × ${MIN_COMPILER_CHUNK_RATIO}）：`,
    );
    console.error('  编译器疑似大面积失效或产物结构骤变——先核实插件是否参与构建；');
    console.error('  确属构建拆分方式变化时，重新实测后调整 MIN_COMPILER_CHUNK_RATIO 并说明理由。');
    return 1;
  }

  console.log(
    `[check-compiler] ✅ 通过：${chunksWithCalls}/${files.length} 个 chunk 含编译器调用点（共 ${totalCalls} 处，下限 ${minChunks}），React Compiler 在构建中生效`,
  );
  return 0;
}

process.exitCode = main();
