// dev-test-env.ts：打包态隔离 dev/test 专用环境变量的唯一判据。
// 这些变量（渲染层 dev server、关窗豁免、dev 更新、额外 env 文件）只应影响开发/测试；
// 打包后的应用若继续信任它们，等于把启动环境变成可改变加载源与 IPC sender 白名单的入口。

/**
 * 读取 dev/test 专用环境变量；打包态一律视为未设置。
 *
 * @param isPackaged app.isPackaged
 * @param name 环境变量名
 * @returns 变量值；打包态为 undefined
 */
export function readDevTestEnv(isPackaged: boolean, name: string): string | undefined {
  return isPackaged ? undefined : process.env[name];
}

/**
 * 判断 dev/test 开关是否开启（仅值为 '1' 视为开启）；打包态恒 false。
 *
 * @param isPackaged app.isPackaged
 * @param name 环境变量名
 * @returns 是否开启
 */
export function isDevTestEnvEnabled(isPackaged: boolean, name: string): boolean {
  return readDevTestEnv(isPackaged, name) === '1';
}

/**
 * 读取渲染层 dev server URL；打包态恒 undefined，确保生产只能 loadFile 加载产物。
 *
 * @param isPackaged app.isPackaged
 * @returns dev server URL；未配置或打包态为 undefined
 */
export function getDevRendererUrl(isPackaged: boolean): string | undefined {
  return readDevTestEnv(isPackaged, 'ELECTRON_RENDERER_URL');
}

/** 启动期 env 文件解析输入 */
export interface EnvFileLoadOptions {
  /** app.isPackaged */
  readonly isPackaged: boolean;
  /** process.env.NODE_ENV */
  readonly nodeEnv: string | undefined;
  /** process.env.APP_ENV_FILE（'' 表示显式禁用） */
  readonly envFile: string | undefined;
  /** 未显式指定时使用的默认路径 */
  readonly defaultPath: string;
}

/**
 * 解析启动时要加载的 env 文件；打包态、test 环境、显式空串均返回 null。
 *
 * @param options 解析输入
 * @returns 要加载的文件路径；null 表示不加载
 */
export function resolveEnvFileToLoad(options: EnvFileLoadOptions): string | null {
  if (options.isPackaged || options.nodeEnv === 'test' || options.envFile === '') {
    return null;
  }
  return options.envFile ?? options.defaultPath;
}
