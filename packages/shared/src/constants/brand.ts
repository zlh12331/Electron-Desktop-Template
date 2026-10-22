// brand.ts：应用品牌与身份的运行时真源（生成物，禁止手改）
// 来源：app.config.json → scripts/generate-brand.mjs（pnpm brand:sync）
// 边界：本文件零依赖，preload 沙箱可直接引入；electron-builder.yml / package.json
// 等无法 import 的位置由 scripts/check-brand.ts 校验一致性。

/** 产品显示名（窗口标题 / 托盘 / 关于页 / 安装包显示名） */
export const PRODUCT_NAME = 'Electron Desktop Template';

/** 应用唯一标识（Windows 注册表 / macOS bundle id / Linux .desktop） */
export const APP_ID = 'com.example.electron-template';

/** 可执行文件名（Linux 桌面条目 / 安装目录名） */
export const EXECUTABLE_NAME = 'electron-desktop-template';

/** 自定义协议 scheme（深链接；须与 electron-builder.yml 的 protocols 一致） */
export const APP_PROTOCOL = 'electron-template';

/** 本地存储键前缀（localStorage / 缓存目录名等） */
export const STORAGE_PREFIX = 'electron-desktop-template';

/** 安装包文件名前缀（artifactName 的连字符形式） */
export const ARTIFACT_BASE_NAME = 'Electron-Desktop-Template';

/** 仓库坐标（自动更新的 GitHub provider） */
export const REPO_OWNER = 'zlh12331';

/** 仓库名 */
export const REPO_NAME = 'Electron-Desktop-Template';
