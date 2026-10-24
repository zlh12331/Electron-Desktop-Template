// electron-env.ts：E2E 启动 Electron 的环境构造器——统一剥离 IDE/Agent 终端注入的
// ELECTRON_RUN_AS_NODE，否则 Electron 以 Node 模式启动，Chromium 开关会被当成非法参数。

/** 基于当前进程环境构造 Electron 子进程 env（剔除 ELECTRON_RUN_AS_NODE + 合并覆盖项） */
export function buildElectronEnv(
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
      env[key] = value;
    }
  }
  return Object.assign(env, overrides);
}
