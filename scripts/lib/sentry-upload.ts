// sentry-upload.ts：Sentry source map 上传的 CLI 命令构造
// 配置解析（release/凭据/跳过原因）已收敛到 @code-agent/shared/observability
import type { SentryUploadConfig } from '@code-agent/shared/observability';

/** source map 上传的完整 CLI 步骤（顺序敏感：先建 release → 注入 debug id → 上传 → finalize） */
export function buildSourcemapCommands(config: SentryUploadConfig): readonly (readonly string[])[] {
  const scope = ['--org', config.org, '--project', config.project];
  return [
    ['releases', 'new', config.release, ...scope],
    ['sourcemaps', 'inject', config.outDir, ...scope],
    ['sourcemaps', 'upload', '--release', config.release, config.outDir, ...scope],
    ['releases', 'finalize', config.release, ...scope],
  ];
}
