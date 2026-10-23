# 目录结构

> 本文件描述模板当前的目录布局。新增目录前先看「扩展点」一节，避免把业务逻辑写进底座。

## 1. 顶层结构

```
.
├── .github/workflows/        # CI（PR 门禁）与 CD（六架构构建 + 发布）
├── app.config.json           # 品牌与身份单一真源（改这里 → pnpm brand:sync）
├── docs/
│   ├── design/               # 设计规范（长期有效）
│   ├── guides/               # 操作指南（CI/CD、派生验收、开源运维）
│   └── history/              # 实施记录（一次性归档）
├── drizzle/                  # 数据库迁移（schema.ts 派生产物，禁止手写）
├── e2e/                      # Playwright：浏览器模式 / Electron / 生产 smoke
├── packages/
│   ├── shared/               # @code-agent/shared：IPC 契约、schema、常量
│   └── tsconfig/             # @code-agent/tsconfig：TS 预设三档
├── resources/                # 图标、安装器脚本、构建期注入的 build-info
├── scripts/                  # 质量门禁与工具脚本（check-* / build-tokens / brand）
├── src/
│   ├── main/                 # 主进程（Electron Node 侧）
│   ├── preload/              # contextBridge 桥接（CJS / sandbox）
│   └── renderer/             # React 19 渲染层
├── tests/integration/        # 集成测试（真实 SQLite + 临时 userData）
├── tools/                    # 独立 TS 子包：depcruise / typedoc
├── biome.json                # lint + format
├── electron-builder.yml      # 打包（三平台 × x64/arm64）
├── electron.vite.config.ts   # 构建
├── knip.json                 # 死代码 / 死依赖
├── pnpm-workspace.yaml       # workspace + 构建脚本决策
└── tsconfig.json             # solution-style 工程引用
```

## 2. 主进程（src/main）

```
src/main/
├── index.ts                  # 入口：单实例锁 / 启动序列 / 退出协商与善后
├── service-container.ts      # 服务容器（lazy accessor + dispose 链）
├── window.ts                 # 主窗创建、导航限制、关窗行为
├── window-show.ts            # 窗口唤起
├── window-theme.ts           # win32 标题栏配色联动
├── tray.ts                   # 系统托盘
├── deep-link.ts              # 自定义协议解析与广播
├── main-events.ts            # 零散状态事件广播
├── quit-state.ts             # 退出状态位
├── diagnostics.ts            # 诊断包导出
├── infra/
│   ├── autostart/            # 开机自启（三平台）
│   ├── file/                 # 用户手势授权表（对话框选中的路径）
│   ├── i18n/                 # 主进程文案（托盘等）
│   ├── invalidation/         # 缓存失效广播
│   ├── network/              # 代理解析与应用（Node/Chromium 双栈）
│   ├── storage/              # SQLite + 本地持久化：db / 迁移 / 设置 / 备份 / keychain / window-state
│   │   └── tables/           # 表定义（core 通用表；业务表按域新增）
│   ├── telemetry/            # OpenTelemetry + 事件循环/内存监控
│   └── update/               # electron-updater 封装
├── ipc/                      # 按域的 handler + 统一注册器
├── security/                 # CSP 等安全基线
└── utils/                    # logger / wrap / error-report / file-permissions / json-file
```

**扩展点**：新增业务服务 = `infra/<domain>/` 新建模块 → `service-container.ts` 加 lazy accessor 与 dispose 步骤 → `ipc/<domain>.handler.ts` → `index.ts` 注册 → shared 侧加 IPC 域（见 19 号规范）。

## 3. 渲染层（src/renderer）

```
src/renderer/
├── main.tsx                  # React 挂载 + 启动快照 + 首帧主题
├── App.tsx                   # RouterProvider + QueryClientProvider
├── router.tsx                # 路由表（hash router，file:// 兼容）
├── routes/                   # 页面（home / about）
├── components/
│   ├── layout/               # AppShell / Sidebar / Topbar / bridges / layout-utils
│   ├── settings/             # 设置壳 + sections/（registry.tsx 是分区注册表）
│   ├── common/               # 对话框宿主、错误边界、命令面板、更新提示
│   └── ui/                   # shadcn 原语（按需增删）
├── hooks/                    # 域 hook（IPC 桥接、查询、快捷键）
├── lib/                      # 无状态工具（ipc / settings-ops / motion / query）
├── stores/
│   ├── persistent/           # 跨重启状态（settings）
│   └── transient/            # 会话内状态（ui / update / confirm）
├── i18n/                     # 初始化 + locales/{zh-CN,en}
├── providers/                # ThemeProvider 等
├── styles/                   # 全局样式 + tokens.css（生成物）
└── test/                     # 测试 setup 与 smoke
```

**扩展点**：新增页面 = `lib/constants.ts` 加路由常量 → `router.tsx` 加 children → `routes/` 建页面。新增设置分区 = `settings-sections.ts` 加 id → `sections/registry.tsx` 加一条。

## 4. 共享包（packages/shared）

```
packages/shared/src/
├── index.ts                  # 包主入口（含 zod，preload 禁用）
├── main.ts                   # 主进程出口
├── renderer.ts               # 渲染层出口（schema 一律 type-only）
├── preload.ts                # preload 出口（零第三方依赖）
├── constants/                # brand（生成物）/ errors / protocol / zoom
├── ipc/
│   ├── meta.ts               # channel 元数据（零依赖）
│   ├── domains/              # 按域定义 + index.ts 域册
│   ├── definitions.ts        # 聚合层 + 编译期双向校验
│   ├── derive.ts             # 类型推导
│   ├── channels.ts           # 通道常量
│   ├── payloads.ts           # 请求/事件类型映射
│   └── with-schema.ts        # 装配原语
└── schemas/                  # 按域的 zod 契约
```

## 5. 测试与门禁

- 单测与源码 colocation：`*.test.ts(x)`
- 集成测试：`tests/integration/`（真实 SQLite，Electron SDK 替身）
- E2E：`e2e/`（浏览器 / Electron / 生产 smoke）
- 门禁入口：`pnpm verify:local`；完整打包验证 `pnpm verify:local:full`