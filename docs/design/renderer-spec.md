# 渲染层规范

> 覆盖 `src/renderer/`：入口、路由、布局、组件分区、hooks、stores、lib、providers、i18n。
> 本文件描述**约定与边界**；具体文件清单见 [03 目录结构](03-directory-structure.md)。

## 1. 入口与启动

- `main.tsx`：React 渲染前同步应用主题（`theme-init`）、拉取设置快照（`settings-bootstrap`）、应用缩放，再挂载 `<App />`。
- `App.tsx`：`AppErrorBoundary` → Providers（I18n → Theme → Query）→ `RouterProvider`。
- `router.tsx`：hash router（`file://` 兼容），页面一律 `route.lazy`。
- `routes/root.tsx`：`RootLayout` 挂 `AppShell`，子页面经 `<Outlet/>` 渲染。

## 2. 布局（`components/layout/`）

- `AppShell`：顶栏 + 左栏 + 主内容 + 右栏骨架；挂载 `useAppBridges()`（全部 IPC 桥接）与全局对话框宿主。
- `Sidebar`：导航骨架，条目由 `NAV_ITEMS` 数据驱动（不是硬编码 JSX）。
- `Topbar`：自绘标题栏，含侧栏/右栏折叠、命令面板、主题切换、更新指示。
- `bridges.ts`：**全部桥接 hook 的唯一挂载点**（新增桥接改这里，不改 AppShell）。
- `layout-utils.ts`：从 CSS 令牌解析 clamp 宽度（侧栏/右栏拖拽）。

**扩展点**：右栏当前为空（模板不预设工作区面板）。需要时在 `layout/` 下新建面板组件，把它挂进 `AppShell` 的 `<aside className="chat-right-panel">`。

## 3. 路由页面（`routes/`）

- `home.tsx`：欢迎页——模板的落地页，接入方第一个替换的对象。
- `about.tsx`：示例业务路由，演示「新增页面要改哪三处」。

新增页面：`lib/constants.ts` 加常量 → `router.tsx` 加 children（lazy）→ 新建 `routes/<page>.tsx`。

## 4. 组件分区（`components/`）

| 目录 | 内容 |
|---|---|
| `layout/` | AppShell / Sidebar / Topbar / bridges / layout-utils |
| `settings/` | `SettingsDialog` 壳 + `sections/`（`registry.tsx` 是分区注册表） |
| `common/` | DialogHost、错误边界、命令面板、快捷键帮助、更新提示、空状态、BrandMark |
| `ui/` | shadcn 原语（按需保留；不用即删，knip 会报死文件） |

## 5. Hooks（`hooks/`）

| Hook | 用途 |
|---|---|
| `use-app-bridges` 的组成项：`use-invalidation-bridge` / `use-update-bridge` / `use-settings-bridge` / `use-deep-link` / `use-protocol-check` / `use-zoom-effect` | 主进程推送桥接（在 `layout/bridges.ts` 集中挂载） |
| `use-update` / `use-install-update` / `use-backups` | 更新状态与安装、备份列表 |
| `use-app-info` / `use-system` / `use-telemetry` | 应用信息、运行时状态、遥测级别 |
| `use-keyboard-shortcuts` | 快捷键（可配置键取自 settings.shortcuts） |
| `use-layout-breakpoint` / `use-resizable-panels` | 响应式断点、栏宽拖拽 |
| `use-async-view` / `use-latest-ref` | 通用工具 |

**约定**：`.tsx` 组件不直连 `window.api`；IPC 调用一律在 hooks/lib 中封装（`check:ui-consistency` 卡关）。

## 6. Stores（`stores/`）

分工铁律：IPC `invoke` 的 server state → TanStack Query；IPC 推送事件 → Zustand transient；UI 交互态 → Zustand transient；组件独享 → useState。

- `persistent/settings-store`：跨重启设置（写穿透 SQLite + 启动快照）。
- `transient/ui-store`：对话框开合、栏宽折叠、命令面板、设置分区。
- `transient/confirm-dialog-store`：命令式 `confirm()`（危险操作统一入口）。
- `transient/update-store`：更新状态推送落地。

## 7. lib（`lib/`）

| 文件 | 职责 |
|---|---|
| `ipc.ts` | `window.api` 类型化封装，`unwrap()` / `unwrapErrorMessage` 单一出口 |
| `ipc-factories.ts` | `ipcOk` / `ipcErr` 构造 |
| `query/query-client.ts` | TanStack QueryClient 单例 |
| `settings-ops.ts` | 设置页动作桥接（导出导入 / 数据目录 / 诊断包 / 自启 / 代理测试 / 代理凭据清除 / 缓存） |
| `settings-sections.ts` | 设置分区 id（叶子常量） |
| `invalidation/` | 失效域 → queryKey 前缀映射与应用 |
| `motion/` | transitions / variants 集中定义 |
| `theme-init.ts` | 首帧主题（与 index.html 内联脚本同源 key） |
| `settings-bootstrap.ts` | 启动快照拉取 + legacy 迁移 |
| `zoom.ts` / `format-bytes` / `format-time` / `format-intl` / `language-endonyms` / `shortcut-conflicts` / `utils` / `error-report` / `error-actions` / `app-actions` / `dialog-actions` / `devtools-actions` | 纯函数与动作封装 |

## 8. Providers（`providers/`）

- `QueryProvider`（含 DEV 限定的 devtools，`check:devtools` 断言不进产物）。
- `ThemeProvider`：`documentElement.classList` 切双主题，配合令牌。
- `I18nProvider`：最外层，`useSuspense: false`（资源已打包）。

## 9. i18n（`i18n/`）

- 命名空间 `common` + `errors`；语言包 `locales/<lang>/*.json`，zh-CN 与 en 必须同构。
- 语言存 SQLite（`settings.language`），localStorage 仅作 detector 同步缓存。
- `useTranslation` / `useErrorMessage` 封装；`check:i18n --strict` 卡缺失、冗余、双语不一致与硬编码文案。

## 10. dev 与测试

- `dev/mock-api.ts`：浏览器模式（`pnpm dev:web`）的 `window.api` 假实现，只覆盖通用域；`createMockApi` 受 `IpcApi` 编译期约束，`mock-api.test.ts` 按 `IPC_META` 校验方法集。
- `test/setup.ts`：jsdom + jest-dom + ResizeObserver / IntersectionObserver / matchMedia polyfill + 空 `window.api` 骨架。
- `test/smoke.test.tsx`：测试基建冒烟。

## 11. 关键文件

- 入口：`main.tsx` / `App.tsx` / `router.tsx` / `routes/root.tsx`
- 壳：`components/layout/AppShell.tsx` / `bridges.ts` / `Sidebar.tsx` / `Topbar.tsx`
- 设置：`components/settings/SettingsDialog.tsx` / `sections/registry.tsx`
- 桥接：`hooks/use-invalidation-bridge.ts` 等，统一在 `layout/bridges.ts` 挂载