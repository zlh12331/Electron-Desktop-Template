// scripts/generate-brand.mjs
// 品牌真源 app.config.json → packages/shared/src/constants/brand.ts（生成物，禁止手改）
// 为什么生成而不是运行时 import JSON：主进程 / preload / 渲染层三条构建链都要读，
// 生成 TS 常量可让 tsconfig、knip、biome 一致纳入类型与检查；JSON import 在 preload
// （CJS 沙箱）链路上还要额外处理断言与打包路径。
// 用法：pnpm brand:sync（改 app.config.json 后执行）；check:brand 会校验产物是否落后于真源。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BRAND_SOURCE = 'app.config.json';
export const BRAND_OUTPUT = 'packages/shared/src/constants/brand.ts';

/**
 * 读取品牌真源。
 * @returns {any} app.config.json 解析结果
 */
export function readBrandSource() {
  return JSON.parse(readFileSync(join(ROOT, BRAND_SOURCE), 'utf8'));
}

/**
 * 由真源渲染生成物内容（纯函数，供 check:brand 比对漂移）。
 * @param {Record<string, any>} brand
 * @returns {string}
 */
export function renderBrandModule(brand) {
  const repoOwner = brand.repo?.owner ?? '';
  const repoName = brand.repo?.name ?? '';
  return `// brand.ts：应用品牌与身份的运行时真源（生成物，禁止手改）
// 来源：app.config.json → scripts/generate-brand.mjs（pnpm brand:sync）
// 边界：本文件零依赖，preload 沙箱可直接引入；electron-builder.yml / package.json
// 等无法 import 的位置由 scripts/check-brand.ts 校验一致性。

/** 产品显示名（窗口标题 / 托盘 / 关于页 / 安装包显示名） */
export const PRODUCT_NAME = '${brand.productName}';

/** 应用唯一标识（Windows 注册表 / macOS bundle id / Linux .desktop） */
export const APP_ID = '${brand.appId}';

/** 可执行文件名（Linux 桌面条目 / 安装目录名） */
export const EXECUTABLE_NAME = '${brand.executableName}';

/** 自定义协议 scheme（深链接；须与 electron-builder.yml 的 protocols 一致） */
export const APP_PROTOCOL = '${brand.protocol}';

/** 本地存储键前缀（localStorage / 缓存目录名等） */
export const STORAGE_PREFIX = '${brand.storagePrefix}';

/** 安装包文件名前缀（artifactName 的连字符形式） */
export const ARTIFACT_BASE_NAME = '${brand.artifactBaseName}';

/** 仓库坐标（自动更新的 GitHub provider） */
export const REPO_OWNER = '${repoOwner}';

/** 仓库名 */
export const REPO_NAME = '${repoName}';
`;
}

function main() {
  const brand = readBrandSource();
  const content = renderBrandModule(brand);
  writeFileSync(join(ROOT, BRAND_OUTPUT), content, 'utf8');
  console.log(`[generate-brand] ✅ ${BRAND_SOURCE} → ${BRAND_OUTPUT}`);
}

if (process.argv[1]?.endsWith('generate-brand.mjs')) {
  main();
}
