// scripts/lib/acceptance/plan.ts
// 派生验收的纯计划层：品牌、初始化参数、平台构建脚本与安装包文件名。
// 运行时命令与文件系统操作在 commands.ts / copy.ts，便于单测不启动任何进程。

/** 派生验收使用的品牌与仓库参数 */
export interface AcceptanceBrand {
  /** 测试产品名（固定，便于日志检索） */
  readonly productName: string;
  /** 测试 appId */
  readonly appId: string;
  /** 测试协议（带时间戳，避免与真实应用/上一次验收冲突） */
  readonly protocol: string;
  /** 测试仓库 owner */
  readonly owner: string;
  /** 测试仓库名 */
  readonly repo: string;
  /** 测试作者 */
  readonly author: string;
}

/**
 * 生成一次验收使用的品牌参数
 *
 * @param now 当前时间（测试注入固定值）
 */
export function createAcceptanceBrand(now: Date = new Date()): AcceptanceBrand {
  return {
    productName: 'Derived Acceptance Lab',
    appId: 'com.example.derived-acceptance',
    protocol: `derived-acceptance-${now.getTime().toString(36)}`,
    owner: 'template-acceptance',
    repo: 'derived-acceptance',
    author: 'Template Acceptance',
  };
}

/**
 * 生成 init:template 的参数数组
 *
 * @param brand 验收品牌
 * @param dryRun 是否只预览
 */
export function buildInitArgs(brand: AcceptanceBrand, dryRun: boolean): string[] {
  const args = [
    'init:template',
    '--name',
    brand.productName,
    '--app-id',
    brand.appId,
    '--protocol',
    brand.protocol,
    '--owner',
    brand.owner,
    '--repo',
    brand.repo,
    '--author',
    brand.author,
  ];
  if (dryRun) {
    args.push('--dry-run');
  }
  return args;
}

/**
 * 当前平台/架构对应的打包脚本
 *
 * @param platform Node 平台标识
 * @param arch Node 架构标识（x64 / arm64）
 * @throws Error 平台或架构不支持时
 */
export function platformBuildScript(platform: NodeJS.Platform, arch: string): string {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`不支持的架构：${arch}（仅支持 x64 / arm64）`);
  }
  if (platform === 'win32') {
    return `build:win:${arch}`;
  }
  if (platform === 'darwin') {
    return `build:mac:${arch}`;
  }
  if (platform === 'linux') {
    return `build:linux:${arch}`;
  }
  throw new Error(`不支持的平台：${platform}（仅支持 win32 / darwin / linux）`);
}

/**
 * Windows NSIS 安装包文件名（与 electron-builder.yml 的 artifactName 同构）
 *
 * @param artifactBaseName app.config.json 的 artifactBaseName
 * @param version package.json 的版本
 * @param arch 目标架构
 */
export function installerFileName(artifactBaseName: string, version: string, arch: string): string {
  return `${artifactBaseName}-Windows-${arch}-${version}.exe`;
}
