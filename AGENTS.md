# AGENTS.md — Electron 桌面端模板

跨平台桌面应用模板（Windows/macOS/Linux）：Electron 45 + React 19 + TypeScript + Vite 8。
底座能力已就绪（IPC 契约体系、SQLite 设置持久化、三平台打包与自动更新），业务页面待接入。

## 重要命令

```bash
pnpm dev                    # 启动 dev server + Electron 窗口
pnpm dev:web                # 浏览器模式 dev（vite.web.config.ts，配合 src/renderer/dev/mock-api.ts）
pnpm typecheck              # tsc --build + tsc -p scripts/tsconfig.json + tsc -p tsconfig.tests.json（不要用 --noEmit）
pnpm lint                   # biome check .（含格式/import 排序）
pnpm lint:fix               # 自动修复
pnpm test                   # 全部测试链式：packages → main → renderer → preload → integration → scripts

# 单层测试
pnpm --filter @code-agent/shared run test
pnpm test:main
pnpm test:renderer
pnpm test:preload
pnpm test:integration
pnpm test:scripts
pnpm test:coverage          # 四层覆盖率 + 范围/关键模块/settings 硬门槛

# E2E（@playwright/test 升级后需 npx playwright install）
pnpm test:e2e               # 浏览器模式（含 a11y 扫描）
pnpm test:a11y              # 无障碍扫描（WCAG 2.1 AA，axe）
pnpm test:e2e:electron      # Electron 真实窗口
pnpm test:visual            # Windows 视觉基线（独立配置，避免 Linux 字体假红）
pnpm test:smoke             # 生产构建 smoke（需先 build:dist）

# 模板底座验收（仓库外副本；--nsis 会真实安装/卸载测试应用）
pnpm acceptance:derived
pnpm acceptance:nsis --installer <path-to.exe> --yes

# 质量门禁
pnpm check:static           # 静态审计 19 项（见下）
pnpm check:tokens           # 设计令牌：裸色/hex/字号/间距双写
pnpm check:i18n             # i18n：缺失 + 双语一致 + 冗余（默认 --strict）
pnpm check:brand            # 品牌一致性：app.config.json ↔ 生成物与构建配置
pnpm check:schema-drift     # schema.ts ↔ drizzle/ 迁移漂移
pnpm check:observability-config # 可观测性变量注册表 ↔ 代码/.env/文档/CI
pnpm check:observability-slo    # SLO 定义 ↔ 指标注册表/运行手册
pnpm observability:doctor    # 脱敏生效配置 + 格式校验 + OTLP 探测（--release 发布断言）
pnpm observability:smoke     # 真实 Electron → 本地 OTLP 三类信号到达（需先 pnpm build）
pnpm observability:collector-smoke # 隔离本地 Collector：持久队列 SIGKILL 恢复与尾采样（需 Docker）
pnpm check:secrets-git      # gitleaks 扫 <远端 main>..HEAD（pre-push 与 CI 用）
pnpm check:secrets          # gitleaks 扫工作区全量文件（手动排查用，含未提交改动）
pnpm knip                   # 死代码 / 死依赖（CI 卡关）

# 品牌
pnpm brand:sync             # app.config.json → packages/shared/src/constants/brand.ts

# 构建
pnpm build                  # electron-vite 构建（out/）
pnpm build:win:x64          # 构建 + 打包（示例；mac/linux 同理）
pnpm analyze:bundle         # 包体积分析（ANALYZE_BUNDLE=1）

# 文档
pnpm docs:types             # TypeDoc 契约文档
pnpm tokens:build           # Style Dictionary 生成 tokens.css
```

`check:static` 覆盖：tokens + i18n + comments（过期注释/失效文件引用）+ tsdoc（export 符号 TSDoc 棘轮）+ file-size（净行 ≤600）+ functions（形参 ≤4 / 函数体 ≤200）+ complexity（认知复杂度 ≤15）+ coverage-floors + observability-config（变量注册表/文档/CI 一致）+ observability-slo（SLO 定义与指标名/手册一致）+ docs + docs-scripts + docs-contracts（IPC 计数/门禁数/ErrorCode/路径引用）+ test-boundary + csp-hash + css-vars + animations + ui-consistency + brand，全部棘轮只收紧。

上列「形状门禁」的扫描范围（如实）：`check:file-size` = `src/**` + `packages/*/src/**` + `scripts/**`；`check:complexity` = `src/**` + `scripts/**`；`check:functions`（形参 / 函数体）= `src/main` + `src/renderer` + `scripts/**`；`check:tsdoc` = `src/**`。测试文件（`*.test.*` / `__tests__`）不计入上述门禁；`e2e/`、`tests/` 不在形状门禁内——门禁脚本自身靠 `pnpm test:scripts`（规则核单测）看住正确性，E2E 靠 Playwright 套件。`scripts/` 首次纳入时的存量超限（如 `init-template.ts` 净行、19 个复杂度文件）已登记在 `scripts/*.baseline.json`，棘轮只允许收紧。

本地全量验证：`pnpm verify:local`（质量层）/ `pnpm verify:local:full`（追加构建与打包）。

## 架构

```
src/main/        → 主进程（Node.js, sandbox: true）
src/preload/     → 桥接（CJS, contextBridge）
src/renderer/    → React 渲染层
packages/shared/ → 跨进程共享：IPC 契约 / zod schema / 常量
packages/tsconfig/→ base.json / node.json / web.json
scripts/         → check-* 门禁与工具脚本
tools/           → 独立 TS 子包（depcruise / typedoc）
```

- 主进程是 Service Container 模式（`service-container.ts`）：私有字段 + lazy accessor + `dispose()` 善后链。当前只有更新服务；新增服务按同一模式追加并登记 dispose 步骤。
- 启动序列（`index.ts`）：logger → 遥测 → DB → i18n → 代理 → 错误兜底 → 崩溃恢复 → IPC 注册 → 更新 → CSP → 监控 → 窗口 → 托盘。
- IPC 三层真源：`shared/ipc/meta.ts`（零依赖 channel）→ `shared/ipc/domains/*.ts`（schema 绑定）→ `definitions.ts`（聚合 + 编译期双向校验）。派生：`channels.ts` / `payloads.ts` / `api.ts`。
- 通道命名：`{domain}:{action}` / `{domain}:event:{name}` / `{domain}:stream:{event}`。
- 流式事件走 subscribe 回调，返回 unsubscribe。

## 渲染层四层状态

| 层  | 载体                     | 用途                 |
| --- | ------------------------ | -------------------- |
| L1  | `useState`               | 组件内瞬态           |
| L2  | Zustand `persistent/`    | 跨重启（settings）   |
| L3  | TanStack Query           | IPC invoke 请求-响应 |
| L4  | IPC event → `transient/` | 主进程推送           |

判断标准：invoke → Query；订阅推送 → Zustand；UI 交互态 → Zustand transient；组件独享 → useState。

## 关键约束（易踩坑）

- **preload 必须 CJS**（`sandbox: true`）：纯 ESM 包（如 zod）引入会静默失败导致 `window.api` 为 undefined。preload 只能经 `@code-agent/shared/preload` / `ipc/meta` / `ipc/channels` 子路径导入。
- **Electron 45 sandboxed preload 无 Node shim**：`Buffer` / `events` / `timers` / `url` 不再注入；需要 UUID 等能力用 Web Crypto，不要在 preload 引入 Node 内置模块。
- **safeStorage 用异步 API**：`encryptStringAsync` / `decryptStringAsync`（45 起同步方法弃用）；凭据写入/读取集中在 `src/main/infra/storage/keychain.ts`。
- **组件不直连 `window.api`**：经 `hooks/` 或 `lib/` 桥接（`check:ui-consistency` 卡关）。
- **响应一律 `unwrap()`**（`lib/ipc.ts`），禁手写 `'data' in resp`。
- **useMutation 必须挂 `onError`** → `toast.error(unwrapErrorMessage(...))`。
- **危险操作**用命令式 `confirm()`（`confirm-dialog-store`），禁内联 AlertDialog。
- **exactOptionalPropertyTypes / noUncheckedIndexedAccess / isolatedDeclarations 已启用**：可选字段传 undefined 需条件展开；导出必须显式标注类型。
- **React Compiler 已启用**（`oxc-transform-react`）：新代码默认不写 `useMemo`/`useCallback`。但 vitest 不跑 Compiler —— effect 依赖的函数身份稳定性必须用 ref 固定，不能依赖编译器。
- **根级新增 `*.config.ts` 必须登记进 `tsconfig.configs.json`**，否则 typecheck 不覆盖。
- **动效统一走 `src/renderer/lib/motion/`**，不散写 CSS transition。
- **网页承载必须用 `WebContentsView`**（独立 session 分区），不能回渲染层 iframe（CSP/XFO 三层拦截）；新 partition 必须调用 `hardenSession()` 复用 CSP/权限收口（`src/main/security/session-hardening.ts`）。
- **dev 环境**：userData 重定向到 `.electron-user-data/`；开启 CDP 9222；`.env` 由 `process.loadEnvFile()` 加载。
- **全新安装**：根 `postinstall` 先安装并校验 Electron 二进制，再重编 `better-sqlite3`；失败会显式退出。`pnpm dev` 报 `Electron uninstall` 说明安装钩子未执行。
- **依赖策略**：只支持 Node 26 LTS；安全补丁、major 评审、beta 禁令与 override 生命周期见 [dependency-policy.md](docs/guides/dependency-policy.md)。

## 数据库

- SQLite（better-sqlite3）+ Drizzle ORM；`src/main/infra/storage/schema.ts` 是唯一真源（当前仅 `app_settings`）。
- 迁移：改 `schema.ts` → `pnpm exec drizzle-kit generate` → 提交 `drizzle/`；禁手写第二份 DDL。
- 表定义在 `storage/tables/`：`core.ts` 为通用表；业务表按域新建文件并在 `schema.ts` 登记。
- 启动期热备份轮转 + `quick_check` 损坏自愈（`db.ts`）。
- 设置真源 = `app_settings`；渲染层内存态经 `settings:set` 写穿透，启动时 `settings:getAll` 拉快照。
- SQLite 主库默认不加密（凭据单独走 safeStorage）；存 PII/敏感业务数据时，派生项目需自行接 SQLCipher 或依赖 OS 全盘加密。

## 代码风格（Biome 非默认项）

- `useNamingConvention` 默认 `strictCase`（注册表字段用小写驼峰）。
- 禁止 `default export`（例外：renderer `*.tsx`、config 文件、scripts）。
- 禁止 `console`（例外：集成测试 / E2E / scripts）。

## 测试规范

- 业务逻辑不 mock：测试真实实现（DI 注入 fake）；基础设施（electron / 原生模块）可 stub。
- 测试与源码 colocation：`*.test.ts(x)`；集成测试在 `tests/integration/`。
- 覆盖率下限真源 = `scripts/coverage-floors.json`（棘轮，只收紧）。
- `pnpm test:coverage` 额外执行：`check:coverage-scope`（未进入 lcov 的源码必须显式登记为入口/E2E 责任）、`check:critical-coverage`（db/CSP/IPC/更新/凭据等按文件阈值）、`coverage:settings --check`（settings 子集硬卡）。
- 纯函数适合用 fast-check 属性测试补强。
- 模板底座改动（`init-template` / `postinstall` / 打包 / 发版基线）必须按 [派生验收指南](docs/guides/template-acceptance.md)在干净副本验证；源仓库 `verify:local` 全绿不代表派生项目可用。

## 扩展点速查

| 要做的事                         | 改哪里                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 改品牌（产品名/appId/协议/图标） | `app.config.json` → `pnpm brand:sync`；图标另替换 `resources/icons/icon.png` 并重跑 `scripts/generate-tray-assets.py` |
| 派生项目站点                     | `init:template` 默认移除 `site/` + `static.yml`；`--keep-site` 保留并改写品牌/仓库                                    |
| 加一个 IPC 方法                  | `ipc/meta.ts` + `ipc/domains/<domain>.ts` + `main/ipc/<domain>.handler.ts`；`scaffold:ipc` 自动同步 19-ipc-spec 计数  |
| 加一个 IPC 域                    | 新建 domain 文件 + `ipc/domains/index.ts` 登记 + main 侧 handler                                                      |
| 加一个数据表                     | `storage/tables/<domain>.ts` + `schema.ts` 登记 + `drizzle-kit generate`                                              |
| 加一个页面                       | `lib/constants.ts` + `router.tsx` + `routes/<page>.tsx`                                                               |
| 加一个设置分区                   | `lib/settings-sections.ts` + `settings/sections/registry.tsx` + 分区组件                                              |
| 加一个主进程服务                 | `infra/<domain>/` + `service-container.ts`（accessor + dispose）                                                      |
| 加一个桥接 hook                  | `hooks/` + `components/layout/bridges.ts`                                                                             |
<!-- notes-example:start -->
| 示例切片 / 删除 | 看/删 Local Notes：`docs/design/notes-example.md`（`init:template` / `remove:notes-example`） |
<!-- notes-example:end -->

## 外部服务 / 凭据

- 凭据用 Electron `safeStorage` 加密（Windows DPAPI / macOS Keychain / Linux libsecret）。
- 错误/崩溃上报（Sentry）：`SENTRY_DSN` 未配置即完整 no-op；发布 CI 可用 `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` 上传 source map（缺失时明确跳过）。
- 遥测（OpenTelemetry）：`OTEL_EXPORTER_OTLP_ENDPOINT` 未配置时打包版不外发，dev 仅 Console trace；完整级别/指标/日志清单见 [23 可观测性](docs/design/23-otel-spec.md)。
- 遥测级别 `off` / `error-only` / `full` 由设置页控制（写 `telemetry-pref.json`，重启生效）；本地日志始终写，诊断包导出时脱敏。
- 报障走 GitHub Issue + 诊断包导出（无云端上报依赖）。本地 SigNoz / Sentry 配置见 [observability-runbook.md](docs/guides/observability-runbook.md)。
- 配置改了先跑 `pnpm observability:doctor --offline`；发布前 CI 会跑 `--release --offline` 断言。配置真源在 `packages/shared/src/observability/env.ts`。

## 构建产物 & Git

- 生成物一律不入仓：`out/` = electron-vite 产物；`release/` = electron-builder 产物；`coverage/<层>/` = 测试覆盖率（lcov / html / json-summary）；构建与测试缓存固定落在 `node_modules/.cache/tsbuildinfo/` 与 `node_modules/.vite/<层>/`——缓存落位由工程配置显式指定（tsconfig 的 `tsBuildInfoFile`、vitest 的 `cacheDir`），不按 root 默认解析，避免生成物漂进源码目录。
- 预提交：lint-staged（Biome 自动修复）。pre-push：gitleaks 密钥扫描（`SKIP_PREPUSH=1` 跳过）。
- 提交信息：Conventional Commits（commitlint 校验）；`feat`/`fix`/`perf` 才计入升版。
- 发版：release-please 开 Release PR → 合并 → CD 三平台构建 → 打 tag 发布。详见 `RELEASING.md`。
- 动打包链路的 PR（`electron-builder.yml` / NSIS 相关）合并前须本地跑 `pnpm build:win:x64` → `check:native-arch` → `pnpm test:smoke`。

## 已移除（相对上游完整产品）

模板从完整 Code Agent 桌面应用派生，以下能力已剥离，需要时按「扩展点速查」重新接入：
AI Agent 运行时与工具系统、会话/消息/回合数据、文件树与编辑器、终端、Git 面板、浏览器预览、MCP、记忆引擎、IM 渠道、远程控制、模型管理、技能系统。
