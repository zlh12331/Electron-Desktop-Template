import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 导入 CLI 不应启动应用，测试解析或工具扫描也不能产生网络副作用。
if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const { runLocalSmoke } = await import('./lib/observability-smoke-app');
    await runLocalSmoke(process.argv.slice(2));
    console.log(
      '[observability-smoke] PASS: all assertions and cleanup completed; local synthetic events only',
    );
  } catch (error) {
    console.error('[observability-smoke] FAIL:', error);
    process.exit(1);
  }
}
