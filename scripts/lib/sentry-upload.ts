// sentry-upload.ts：Sentry source map 上传的纯配置解析（CLI 入口在 scripts/sentry-sourcemaps.ts）
// 边界：不读文件系统、不 spawn 子进程；只决定「是否上传」与「按什么 release / 参数上传」，便于单测

/** 上传配置（skipReason 非空时其余字段仍解析，便于日志说明缺哪项） */
export interface SentryUploadConfig {
  readonly authToken: string;
  readonly org: string;
  readonly project: string;
  readonly release: string;
  readonly outDir: string;
  /** 非空 = 本次跳过上传（缺少凭据或显式禁用） */
  readonly skipReason: string | null;
}

/** 解析 Sentry release 名：运行时与 CI 必须同源（默认 {可执行名}@{版本}） */
export function resolveSentryRelease(
  env: NodeJS.ProcessEnv,
  executableName: string,
  version: string,
): string {
  const override = env['SENTRY_RELEASE']?.trim();
  if (override !== undefined && override !== '') {
    return override;
  }
  return `${executableName}@${version}`;
}

/**
 * 解析上传配置：三项凭据（token/org/project）任一缺失即跳过
 *
 * @param env 环境变量
 * @param executableName app.config.json 的 executableName
 * @param version package.json 版本
 * @param outDir electron-vite 产物目录
 */
export function resolveSentryUploadConfig(
  env: NodeJS.ProcessEnv,
  executableName: string,
  version: string,
  outDir: string,
): SentryUploadConfig {
  const authToken = env['SENTRY_AUTH_TOKEN']?.trim() ?? '';
  const org = env['SENTRY_ORG']?.trim() ?? '';
  const project = env['SENTRY_PROJECT']?.trim() ?? '';
  const release = resolveSentryRelease(env, executableName, version);

  let skipReason: string | null = null;
  if (env['SENTRY_UPLOAD_DISABLED'] === '1') {
    skipReason = 'SENTRY_UPLOAD_DISABLED=1';
  } else {
    const missing = [
      ...(authToken === '' ? ['SENTRY_AUTH_TOKEN'] : []),
      ...(org === '' ? ['SENTRY_ORG'] : []),
      ...(project === '' ? ['SENTRY_PROJECT'] : []),
    ];
    if (missing.length > 0) {
      skipReason = `缺少 ${missing.join(' / ')}`;
    }
  }

  return { authToken, org, project, release, outDir, skipReason };
}

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
