# 技术栈

> 版本以根 `package.json` 为唯一真源；本文件只解释选型与边界，不重复锁定版本号。

## 1. 运行时与框架

| 领域 | 选型 | 说明 |
|---|---|---|
| 桌面容器 | Electron 44 | 主进程 Node 侧 + Chromium 渲染侧；三平台打包 |
| 渲染框架 | React 19 + React Compiler | 编译器经 `oxc-transform-react` 生效（`check:compiler` 断言产物痕迹） |
| 构建 | electron-vite（Vite 8） | main / preload / renderer 三目标；preload 强制 CJS |
| 语言 | TypeScript 7（严格模式） | `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` / `isolatedDeclarations` |
| 路由 | React Router 8（hash router） | `file://` 下 history 路由失效，hash 兼容 dev 与生产 |
| 状态 | Zustand + TanStack Query | 客户端状态与服务端缓存分离（见架构文档 §5） |

## 2. 主进程依赖

| 领域 | 选型 | 边界 |
|---|---|---|
| 数据库 | better-sqlite3 + drizzle-orm | 同步 API；schema 单一真源，迁移由 drizzle-kit 派生 |
| 日志 | electron-log | 落本地文件，traceId 贯穿；渲染层经 IPC 转发 |
| 更新 | electron-updater | GitHub provider；三平台产物元数据由 release.yml 生成 |
| 遥测 | OpenTelemetry（OTLP/HTTP） | 未配置 endpoint 即不外发 |
| 网络 | undici | 统一 fetch 实现，代理配置注入（`infra/network/proxied-fetch`） |
| 压缩 | adm-zip | 诊断包导出 |
| 契约校验 | zod 4 | IPC 入参/响应；preload 与渲染层出口按进程拆分，避免 zod 进沙箱 |
| Markdown | react-markdown + rehype | 关于页渲染 release notes（sanitize 后渲染） |

## 3. 渲染层依赖

| 领域 | 选型 | 说明 |
|---|---|---|
| 组件原语 | shadcn/ui（Radix + Tailwind 4） | `components/ui/` 按需保留；令牌来自 `tokens/aurora.json` |
| 样式 | Tailwind CSS 4 + CSS 变量令牌 | 禁止裸色值/魔法数（`check:tokens`） |
| 动效 | motion | 统一走 `lib/motion/`（transitions / variants） |
| 图标 | lucide-react | — |
| 提示 | sonner | Toast 单一实现 |
| 命令面板 | cmdk | — |
| 快捷键 | react-hotkeys-hook | 键位配置持久化在 settings.shortcuts |
| 国际化 | i18next + react-i18next | zh-CN / en 双语，key 引用与冗余由 `check:i18n` 卡关 |

## 4. 工程链

| 领域 | 选型 | 说明 |
|---|---|---|
| 包管理 | pnpm 12 workspace | `pnpm-workspace.yaml` 统一声明构建脚本决策与 store 位置 |
| Lint/Format | Biome 2 | 含 import 排序；`useNamingConvention` 默认 strictCase |
| 单测 | Vitest 5 | 与源码 colocation；覆盖率下限存 `scripts/coverage-floors.json` |
| E2E | Playwright | 浏览器模式 / Electron / 生产 smoke 三套配置 |
| 依赖方向 | dependency-cruiser | 独立 TS 6 子包（`tools/depcruise`） |
| 死代码 | knip | files / deps / binaries 级卡关 |
| API 文档 | TypeDoc | 独立 TS 6 子包（`tools/typedoc`），规避 TS7 不兼容 |
| 设计令牌 | Style Dictionary | `tokens/aurora.json` → `src/renderer/styles/tokens.css`（生成物） |
| 发版 | release-please | Conventional Commits + 单分支 prerelease 策略 |

## 5. Monorepo 结构

- `packages/shared`：IPC 契约、zod schema、跨进程常量（按进程拆出口：`.` / `main` / `renderer` / `preload` / `ipc/meta`）
- `packages/tsconfig`：`base.json` / `node.json` / `web.json` 三档
- `tools/depcruise`、`tools/typedoc`：独立 TS 6 环境

## 6. TypeScript 配置

根 `tsconfig.json` 是 solution-style（`files: []` + project references），子工程：

```
packages/tsconfig, packages/shared, src/main, src/preload, src/renderer, tsconfig.configs.json
```

严格选项集中在 `packages/tsconfig/base.json`。根级 `*.config.ts` 必须登记进 `tsconfig.configs.json` 的 `include`，否则 typecheck 不覆盖。

## 7. 平台支持

| 平台 | 目标 | 备注 |
|---|---|---|
| Windows | NSIS（x64 / arm64） | 签名走 `CSC_LINK`；未配置则跳过签名 |
| macOS | dmg + zip（x64 / arm64） | 公证需 Apple 凭据 |
| Linux | AppImage + deb + rpm（x64 / arm64） | 原生模块需在对应架构 runner 构建 |