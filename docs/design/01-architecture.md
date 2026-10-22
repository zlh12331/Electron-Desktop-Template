# 架构设计

> 本文件描述模板的运行时架构。所有结论以当前代码为准，改动架构时同步更新本文件。

## 1. 进程模型

扁平三进程（主 / preload / 渲染），不使用 VS Code 式多进程拆分：

| 进程 | 位置 | 职责 |
|---|---|---|
| main | `src/main/` | 窗口、托盘、DB、文件、更新、IPC handler |
| preload | `src/preload/` | 仅桥接：`contextBridge.exposeInMainWorld('api', api)`，CJS + `sandbox: true` |
| renderer | `src/renderer/` | React 19 UI，无 Node 能力，一律经 `window.api` |

渲染进程崩溃：Electron 重建 webContents，并由 `window.ts` 的 `render-process-gone` 做有限次自动 reload；主进程崩溃：下次启动 `recoverFromCrash()` 清崩溃标记并执行恢复钩子。

## 2. 主进程组合根

`src/main/index.ts` 只做装配：

```
单实例锁 → 协议注册 → whenReady:
  logger → 遥测 → initDb → i18n → 代理 → 错误兜底 → 崩溃恢复
  → registerIpcHandlers(按域的 handler 对象) → update.start → CSP
  → 监控（内存 / 事件循环）→ createWindow → createTray → 冷启动深链补发
```

`service-container.ts` 是服务容器：私有字段 + lazy accessor + `dispose()` 善后链。新增服务按同一模式追加，并在 `dispose()` 中登记清理步骤（单步失败只记日志，不阻断后续步骤）。

## 3. IPC 契约体系（核心资产）

单一真源分三层，全部可推导：

```
shared/ipc/meta.ts          channel + kind（零依赖，preload 可安全引入）
   ↓
shared/ipc/domains/*.ts     每域的 schema 绑定（withSchema / withPayload）
   ↓
shared/ipc/definitions.ts   聚合 + 编译期双向一致性校验
   ↓
channels.ts / payloads.ts / api.ts（派生常量与类型）
```

- **新增一个方法** = `meta.ts` 一行 + `domains/<domain>.ts` 一行 + 主进程 handler 一个方法。preload API、通道常量、类型映射全部自动生成。
- **handler 缺失**：`InferHandlers` 在编译期报错；响应 schema 缺失在注册期抛错拒启。
- **域册**：`domains/index.ts` 显式登记域，删除一个域 = 删文件 + 删登记行。
- **通道命名**：`{domain}:{action}` / `{domain}:event:{name}` / `{domain}:stream:{event}`。

## 4. 数据层

- SQLite（better-sqlite3）+ Drizzle ORM；`src/main/infra/storage/schema.ts` 是唯一真源，`drizzle/` 迁移由 `drizzle-kit generate` 派生（禁止手写第二份 DDL）。
- 表定义按域放在 `storage/tables/`：`core.ts` 为通用表（`app_settings`），业务表按域新建文件并在 `schema.ts` 登记。
- 启动期：热备份轮转（`backups/`）+ `quick_check` 损坏检测 + 从最近健康备份恢复。
- 设置真源 = `app_settings` 表；渲染层内存态经 `settings:set` 写穿透，启动时 `settings:getAll` 拉取快照。

## 5. 渲染层四层状态

| 层 | 载体 | 用途 |
|---|---|---|
| L1 | `useState` | 组件内瞬态（输入、折叠、编辑态） |
| L2 | Zustand `persistent/` | 跨重启（settings） |
| L3 | TanStack Query | IPC invoke 的请求-响应缓存 |
| L4 | IPC event → `transient/` | 主进程推送（更新状态、缓存失效） |

判断标准：invoke → Query；订阅推送 → Zustand；UI 交互态 → Zustand transient；组件独享 → useState。组件不直连 `window.api`，统一经 `hooks/` 或 `lib/` 桥接。

## 6. 错误、日志与可观测

- 所有 IPC handler 经 `utils/wrap.ts` 包装：traceId + 入参 zod 校验 + 响应 schema 校验 + 异常归一为 `IpcResponse.error`。
- 日志：electron-log 落本地文件，`traceId` 贯穿渲染 → 主进程。
- 全局兜底：`registerGlobalErrorHandlers`（主进程）、`AppErrorBoundary` / `SectionErrorBoundary`（渲染层）。
- 遥测：OpenTelemetry 单通道，`OTEL_EXPORTER_OTLP_ENDPOINT` 未配置即不外发；级别由 `telemetry-pref` 控制（off / error-only / full）。

## 7. 安全基线

- `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`。
- CSP 由主进程注入（`security/csp.ts`），含首帧内联脚本哈希锚定（`check:csp-hash`）。
- 导航/新窗限制在 `window.ts`；渲染层系统权限请求一律拒绝。
- 凭据走 `safeStorage` 加密；密钥扫描由 gitleaks 在 pre-push 与 CI 执行。
- asar 完整性校验 + fuses（`runAsNode: false` 等）在 `electron-builder.yml` 声明。

## 8. 构建与发布

- `electron-vite` 构建三份产物（main / preload / renderer），`electron-builder` 打三平台包。
- 品牌与身份真源：`app.config.json` → `pnpm brand:sync` 生成 `packages/shared/src/constants/brand.ts`，`check:brand` 校验构建配置漂移。
- CI：PR 跑 typecheck / lint / 单测 / 集成 / E2E；CD 在 main 上三平台矩阵构建，全绿后打 tag 发布。
- 版本与 CHANGELOG 由 release-please 接管（Conventional Commits + squash 合并）。

## 9. 已知取舍

1. 单窗口设计：渲染进程崩溃整窗重建，不做多窗口隔离。
2. 主进程承载全部重活：模板不预设 LSP / 终端 / 长连接等重型子系统，接入时优先 `utilityProcess` 隔离。
3. `service-container` 保持单文件：服务数量少时可读性最佳，超过约 10 个服务后再考虑拆分。