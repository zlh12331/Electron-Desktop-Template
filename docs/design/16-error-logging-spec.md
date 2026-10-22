# 16. 错误与日志规范

> 统一主进程（electron-log + traceId）、渲染层（ErrorBoundary + sonner）与观测（error-report 本地错误上报 + OTel）的错误处理约定。
> 最后同步：2026-09-24（Sentry 已于 2026-09-13 移除）

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
- 日志条目必须包含 traceId（结构化字段），支持按 traceId 串联一次调用的全链路日志
- 渲染层 console 禁用（Biome 规则），调试用 logger/日志文件

### 2.3 日志纪律

- 禁止记录：API Key/Token/密码（safeStorage 加密存储，日志只记掩码）
- 禁止空 catch（必须按 unknown 缩小 + 记录）
- 网络失败的重试由消费方决定：TanStack Query 默认查询 1 次、mutation 0 次（`lib/query/query-client.ts`），需要退避的场景在 hook 内显式配置

## 三、错误上报与 OTel

- **error-report**（`src/main/utils/error-report.ts` / `src/renderer/lib/error-report.ts`）：异常单一出口，落本地日志（渲染层经 electron-log 转发主进程，随诊断包导出），报障走 GitHub Issue 深链；Sentry 已于 2026-09-13 移除（决策记录见 23-otel-spec）
- **OTel**（@opentelemetry/*）：telemetry/otel.ts 导出 span（可观测性），与 electron-log 互补（结构化指标 vs 文本日志）；未配置 OTLP 端点时不外发

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
