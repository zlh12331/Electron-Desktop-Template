# 16. 错误与日志规范

> 统一主进程（electron-log + traceId）、渲染层（ErrorBoundary + sonner）与观测（error-report 本地错误上报 + OTel）的错误处理约定。
> 最后同步：2026-10-24（日志覆盖矩阵 + IPC 级别/单出口收口）

---
> 🔒 工程化强制：Biome noConsole 规则 + traceId 由 preload 自动附加（运行时强制，非人工约定）

## 一、错误对象契约（主进程 → 渲染层）

### 1.1 AppError

- 主进程所有可预期失败返回 `AppError`（继承 Error）：`code`（ErrorCode 枚举）+ `statusCode` + `message`
- 错误码集中在 `packages/shared/src/constants/`（ErrorCode），跨进程共享
- IPC 失败走 `IpcResponse.error` 判别联合（`{ data } | { error }`），渲染层 `unwrap()` 解包（已有 `lib/ipc.ts`）

### 1.2 渲染层处理

| 场景 | 处理 |
|---|---|
| IPC 调用失败 | `unwrap` 捕获 → 按 `error.code` 查 i18n errors.json → toast.error 或行内提示 |
| 组件渲染异常 | 三层 ErrorBoundary：AppErrorBoundary（根）/ RootErrorBoundary（路由）/ SectionErrorBoundary（分区） |
| 异步数据 | AsyncBoundary 五态契约（loading/refreshing/error/empty/ready），error 态展示重试 |

## 二、日志规范（主进程）

### 2.1 electron-log 层级

| 级别 | 用途 |
|---|---|
| error | 未预期异常（带 stack + traceId） |
| warn | 可恢复异常/降级（fallback 路径） |
| info | 生命周期事件（启动/服务注册/设置变更） |
| debug | IPC 调用明细（traceId + channel + 耗时）——生产关闭 |

### 2.2 traceId 贯穿

- 每次 IPC invoke 生成 `crypto.randomUUID()` 作为 traceId（preload `ipc-bridge.ts` 自动附加，第三参数传主进程）
- IPC 日志带请求 traceId；后台事件可能没有请求 ID。`app.trace_id` 是请求 UUID，不是 OTel 原生 traceId；Sentry 的 `contexts.opentelemetry` 与 OTel LogRecord 另保留原生链路 ID（存在活动 span 时）
- 渲染层 console 禁用（Biome 规则），调试用 logger/日志文件

### 2.3 日志纪律

- 禁止记录：API Key/Token/密码（safeStorage 加密存储，日志只记掩码）
- 禁止在业务失败路径空 catch；清理/关闭/探针等 best-effort 路径允许静默，但必须注释说明为何可忽略
- 网络失败的重试由消费方决定：TanStack Query 默认查询 1 次、mutation 0 次（`lib/query/query-client.ts`），需要退避的场景在 hook 内显式配置

### 2.4 应用覆盖矩阵

| 域 | info / warn / error 记录点 | 说明 |
|---|---|---|
| 启动 / 退出 | 启动完成耗时、Sentry/OTel 状态、CSP、托盘、退出清理 | 启动失败同时进 `reportError` 与原生错误框 |
| IPC | 失败（error）；开始/成功仅 debug | 失败单条日志 + Sentry，不重复写「错误上报」；traceId 贯穿 |
| 设置 | 按键更新、重置、导入/导出完成、遥测级别变更 | 只记键名/级别，不记值 |
| 凭据 | 写入/删除键名、加密不可用、损坏抢救 | 从不记录明文与密文 |
| 深链 / 单实例 | 协议注册结果、深链投递窗口数、第二实例唤起 | 不记录完整 URL |
| 更新 | 检查开始/结果、发现版本、下载完成/取消/失败、安装请求、缓存清理 | 检查失败只 warn；下载失败额外进 Sentry |
| 窗口 / 托盘 | 创建、隐藏启动、关窗动作、主框架加载失败、渲染崩溃、窗口状态读写失败 | 重复崩溃停止自动恢复有专门 error；加载失败同时进 Sentry |
| 数据库 | 初始化、迁移、完整性、恢复、备份轮转/失败 | 损坏/迁移/备份失败额外进 Sentry |
| 网络代理 | 配置应用（URL 脱敏）、连通性测试结果、分区设置失败 | 不记录代理 URL 的用户名密码段 |
| 遥测 / 诊断 | 初始化状态、导出完成/失败、日志读取失败 | 诊断包导出期再做值级脱敏 |
| 渲染层 | 错误经 Electron error / unhandledrejection / 三层 ErrorBoundary 上报 | 通用 console 禁用；仅错误转发，无通用业务日志 |

## 三、错误上报、Sentry 与 OTel

- **error-report**（`src/main/utils/error-report.ts` / `src/renderer/lib/error-report.ts`）：异常单一出口，先落本地日志（渲染层经 electron-log 转发主进程，随诊断包导出并做导出期脱敏），再交可选后端。主进程 `reportError` 的自定义 `message` 和 `fields` 仅写本地；logger 旁路显式使用独立远端上下文，Sentry/OTel 只接收允许的 tags、组件栈和错误对象。SDK console 面包屑被排除以免重新携带本地字段。错误对象本身仍可能含路径，不承诺任意路径自动消失。
- **Sentry**（`@sentry/electron/main`）：主进程错误聚合、原生崩溃与 release health；DSN 未配置时完整 no-op。渲染层错误经 `telemetry:captureError` IPC 转发（渲染层不引入 Sentry SDK），报障深链仍指向 GitHub Issue。
- **OTel**（@opentelemetry/*）：trace（IPC/启动/更新检查与下载）+ metrics（RED、漏斗、资源、Web Vitals）+ logs（主进程结构化日志）；未配置 OTLP 端点时打包版不外发，dev 仅 Console trace。
- 三者的级别语义、脱敏边界与指标清单见 [23 可观测性规范](23-otel-spec.md)。

## 四、渲染层错误 UI 约定

1. **错误文案**：优先 i18n（errors.json 按 code）；无匹配显示原始 message；禁止裸 `error.toString()`
2. **空态**：`EmptyState` 组件（图标 + 标题 + 描述 + 可选操作），禁止空白屏
3. **加载失败重试**：AsyncBoundary error 态带重试按钮（重新 query/重新订阅）
4. **不可逆操作**：命令式 `confirm()`（`confirm-dialog-store`）确认（删除/清空/恢复类）

## 五、检查清单

- [ ] 可预期失败返回 AppError（code + statusCode），不抛裸 Error
- [ ] IPC 入参过 zod（13-form-validation L2）
- [ ] catch 按 unknown 缩小，含 traceId 日志，无空 catch
- [ ] 渲染层错误走 ErrorBoundary 体系 + i18n 文案
- [ ] 日志无敏感信息
