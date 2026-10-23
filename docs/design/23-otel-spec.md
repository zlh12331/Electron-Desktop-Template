# 23 · 可观测性规范（L4：错误聚合 + Trace + Metrics + Logs）

> 基于当前实现：`src/main/infra/telemetry/`、`src/main/utils/error-report.ts`、`src/main/ipc/telemetry.handler.ts`、
> `src/renderer/lib/error-report.ts`、`src/renderer/lib/web-vitals.ts`、`scripts/sentry-*.ts`。
> 最后同步：2026-10-24（配置单一真源 + doctor + 管道健康 + SLO 定义 + 设置页状态/连接测试）

---

## 一、通道总览

| 信号 | 实现 | 职责 | 默认行为 |
|---|---|---|---|
| 本地日志 | electron-log | 逐条事件、错误详情、崩溃前最后证据 | 始终写 `userData/logs/main.log` |
| 错误聚合 / 崩溃 | Sentry（`@sentry/electron/main`） | 异常分组、release health、原生 minidump、告警 | 未配置 DSN 完整 no-op |
| Trace | OpenTelemetry（OTLP/HTTP） | IPC、启动、更新检查的调用链 | 未配置端点且打包版 → no-op；dev 无端点 → Console trace |
| Metrics | OpenTelemetry（OTLP/HTTP） | IPC RED、启动耗时、更新漏斗、内存/事件循环、Web Vitals | 仅 `full` 且配置端点 |
| Logs（结构化） | OpenTelemetry（OTLP/HTTP） | 主进程 warn/error/info 日志进后端，支持按 traceId/属性检索 | `full` 默认 info；`error-only` 只导出 error |
| 诊断包 | adm-zip | 离线排障：manifest + 脱敏设置 + 脱敏日志 + 运行时/可观测性快照 | 用户手动导出 |

设计取舍：

- **Sentry 只做主进程**。渲染层不引入 Sentry SDK：避免 DSN 分发、`connect-src` CSP 放行和两套采样配置；渲染层错误经 `telemetry:captureError` IPC 转发。
- **Sentry 不采集性能**。`tracesSampleRate: 0`，trace 统一走自建 OTel，避免 Sentry span 配额双扣。
- **OTel 不采集错误分组**。错误聚合、release health、原生崩溃归 Sentry；OTel 负责链路和趋势。
- **本地日志始终优先**。任何后端不可用都不能影响本地日志与诊断包。

## 二、遥测级别语义

级别由 `telemetry-pref.json` 持久化（启动时同步读取，设置页修改后**需重启**生效）。

| 级别 | Sentry | OTel Trace | OTel Metrics | OTel Logs | 渲染层转发 |
|---|---|---|---|---|---|
| `off` | 不初始化 | 不初始化 | 不初始化 | 不初始化 | `captureError` 直接返回 `accepted=false`；本地日志仍写 |
| `error-only` | 启用（有 DSN 时） | 关闭 | 关闭 | 仅 error（有端点时） | 启用 |
| `full` | 启用（有 DSN 时） | 采样启用（有端点；dev 无端点走 Console） | 启用（有端点） | 默认 info（有端点） | 启用 |

补充规则：

- `off` 是**网络遥测**关闭，不是日志关闭；本地 electron-log 与诊断包不受影响。
- 运行时把级别改成 `off` 后，Sentry/OTel 的已初始化实例要到重启才停；IPC 侧的渲染层错误会立即按文件值拒绝转发。
- 打包版没有 OTLP 端点时 OTel 完全 no-op；dev 没有端点时只启动 Console trace（`full`），用于本地观察。
- `error-only` + dev 无端点 = OTel 完全 no-op（没有可导出的后端）。

## 三、Sentry

### 3.1 初始化

- 位置：`src/main/infra/telemetry/sentry.ts`；在 `app.whenReady()` 之前调用 `initSentry(level)`（`src/main/index.ts` 模块求值阶段），保证早期异常与原生崩溃能捕获。
- DSN 解析：运行时 `SENTRY_DSN` 优先，其次构建期 `__SENTRY_DSN__`（`electron.vite.config.ts` 的 define，用于安装包内置默认 DSN）。
- release：`SENTRY_RELEASE` 覆盖，否则 `{executableName}@{app.getVersion()}`；必须与 source map 上传脚本一致。
- environment：`SENTRY_ENVIRONMENT` 覆盖，否则 packaged=`production` / dev=`development`。
- 关闭默认的 `PreloadInjection` 集成：本应用不使用渲染层 Sentry SDK，注入只会给每个窗口增加额外 preload 面。
- `ipcMode: IPCMode.Classic`：不注册自定义协议。
- **失败降级**：DSN 缺失 → `reason=no-dsn`；SDK 初始化抛错 → `reason=init-failed`；两者都不影响启动。

### 3.2 采集入口

- 主进程：`utils/error-report.ts` 的 `reportError` / `reportMessage` → `captureMainError` / `captureMainMessage`。
- 渲染层：`lib/error-report.ts` → `telemetry:captureError` → `captureRendererError`。渲染层仍先经 electron-log 落本地日志。
- 全局兜底：`uncaughtException` / `unhandledRejection`（主进程）、`window.error` / `unhandledrejection` / React 三层错误边界（渲染层）。
- 原生崩溃：Sentry minidump 集成启用 `crashReporter`（`uploadToServer:false`，由 Sentry transport 上传）。
- 上次异常退出：`.crash-marker` 记录时间/message/stack，下次启动 `recoverFromCrash` 以 `scope=crash-recovery` 上报（Sentry 离线时仍有本地日志/OTel）。
- 渲染层错误自动带 hash route；IPC handler 把本次 `traceId` 写入 Sentry tags 与 OTel 日志 `app.trace_id`。

### 3.3 脱敏与隐私

- `beforeSend` 对 message / exception.value / breadcrumbs / tags / extra / contexts / request 统一过 `redact.ts`。
- `includeLocalVariables: false`；不附加截图（未开启 `attachScreenshot`）。
- 原生 minidump 是二进制附件，不经过 `beforeSend`；依赖 Sentry 服务端数据清洗，属于启用崩溃上报的已知代价。
- DSN 是客户端公开标识，不是密钥；`SENTRY_AUTH_TOKEN` 才是上传凭据，只放 CI Secrets。

### 3.4 Source map 与符号

- `pnpm build:instrumented` = `pnpm build` + `pnpm sentry:sourcemaps`；所有 `build:*` 打包脚本都走它。
- `scripts/sentry-sourcemaps.ts`：`releases new` → `sourcemaps inject out`（写 debug id）→ `sourcemaps upload` → `releases finalize`。
- 凭据 `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` 任一缺失 → 明确打印跳过原因并退出 0（本地构建不受影响）。
- `sourcemaps inject/upload` 失败会阻断构建，防止发出无法符号化的版本；`releases new/finalize` 在同版本重跑时的失败只告警。
- 原生调试符号：`pnpm sentry:debug-files`，仅在 `SENTRY_UPLOAD_DEBUG_FILES=1` 时上传解包目录（默认关闭，体积大）。

## 四、OpenTelemetry

### 4.1 初始化与端点

`src/main/infra/telemetry/otel.ts`：

- Trace：`NodeTracerProvider` + `BatchSpanProcessor` + `ParentBasedSampler(TraceIdRatioBasedSampler)`。
- Metrics：`MeterProvider` + `PeriodicExportingMetricReader`（默认 60s）+ `OTLPMetricExporter`。
- Logs：`LoggerProvider` + `BatchLogRecordProcessor` + `OTLPLogExporter`，经 `otel-log.ts` 绑定到主进程 logger。
- 退出：解绑日志 sink → 三路 `forceFlush`/`shutdown`（单路 3s 上限，失败只告警）→ 关闭全局 provider。

资源属性：`service.name` / `service.version` / `service.namespace`、`host.arch` / `host.platform`、`process.runtime.*`，以及
`deployment.environment` 与 `deployment.environment.name` **双写**（SigNoz v0.147 仍按旧键做环境过滤；新版语义约定用 `.name`）。

端点解析（`otel-config.ts`，纯函数）：

- `OTEL_EXPORTER_OTLP_ENDPOINT` 是 base URL，自动补 `/v1/traces|metrics|logs`；
- 各信号专用变量 `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` 优先；
- 已填完整 `/v1/xxx` 的 base 会被替换为当前信号的路径；
- `OTEL_EXPORTER_OTLP_HEADERS` 支持 `key=value,key2=value2`（SigNoz Cloud ingestion key 等）。

### 4.2 Trace 约定

命名：`<domain>.<operation>`，IPC 固定为 `ipc {channel}`；更新检查为 `update.check`。

属性只放低基数、非敏感字段：

- IPC span：`rpc.system=electron-ipc`、`rpc.method=<channel>`、`app.trace_id=<preload 生成的 UUID>`。
- 更新检查：`trigger=launch|manual`、`app.version`。
- 禁止入参 payload、prompt 全文、命令全文、凭据/Token；高频流式事件不建 span。

`withSpan(name, attributes, fn, isError?)` 在未初始化时由 OTel API 提供 no-op tracer；`isError` 用于把「已转成错误响应」的 IPC 校验失败也标成 ERROR 状态。

### 4.3 Metrics 清单

| 指标 | 类型 | 关键属性 | 来源 |
|---|---|---|---|
| `ipc.server.requests` | Counter | `channel`, `outcome` | `wrap.ts` |
| `ipc.server.request.duration` | Histogram(ms) | `channel`, `outcome` | `wrap.ts` |
| `app.startup.duration` | Histogram(ms) | `phase=services/window` | `index.ts` |
| `app.update.events` | Counter | `phase` | `update-service.ts` |
| `app.update.check.duration` | Histogram(ms) | `trigger`, `outcome` | `update-service.ts` |
| `app.update.download.duration` | Histogram(ms) | `outcome` | `update-service.ts` |
| `nodejs.eventloop.delay` | Histogram(ms) | — | `index.ts`（5s p99） |
| `nodejs.memory.growth` | Histogram(MB) | `window`（秒） | 内存监控告警时 |
| `process.memory.usage` | ObservableGauge(By) | `state=rss/heap_used/...` | 采集时读取 |
| `electron.process.memory` / `.cpu` | ObservableGauge | `process.type`, `process.name` | `app.getAppMetrics()` |
| `web_vitals.{lcp,fcp,inp,ttfb,cls}` | Histogram | `rating`, `navigation.type` | 渲染层 `web-vitals` |

约束：属性禁止高基数字段（traceId、用户输入、窗口标题全文）；新增指标必须同步本表与运行手册的 SLO。

### 4.4 Logs 与关联

- `logger.ts` 每次写 electron-log 的同时调用 `emitOtelLog`（无 electron-log hook，避免双 transport 重复）。
- 映射：`traceId`→`app.trace_id`、`channel`→`ipc.channel`、`scope`→`log.scope`、`errorCode`→`error.code`、其余→`log.<key>`。
- 异常：`exception.type` / `exception.message` / `exception.stacktrace`。
- 正文/属性/异常栈全部过 `redactText`；单条属性 ≤2KB、正文 ≤8KB、栈 ≤16KB、属性数 ≤24。
- 渲染层错误由 `telemetry.handler.ts` 显式 emit 一条 `renderer.error` 日志（渲染层不直接持有 OTel SDK），并带 `app.trace_id`。
- 级别：`full` 默认 info；`OTEL_LOG_LEVEL` 可调 debug/info/warn/error；`error-only` 固定 error。
- 采样/限流：`OTEL_LOG_SAMPLE_RATIO`（默认 1）只作用于 info/debug；`OTEL_LOG_MAX_PER_MINUTE`（默认 0=不限）作用于非 error；
  warn/error 不采样，避免丢关键错误。
- 管道健康：每个 OTLP exporter 的回调记录 attempts/failures/lastSuccessAt/lastError；采样/限流丢弃数单独计数，
  通过 `telemetry:getStatus`、诊断包 `runtime.json` 与设置页状态卡展示。

### 4.5 渲染层 Web Vitals

- `src/renderer/lib/web-vitals.ts` 在 `main.tsx` 启动时采集 CLS/FCP/INP/LCP/TTFB（web-vitals v6）。
- 批量：满 10 条或 5s 定时 flush；`pagehide` / `visibilitychange=hidden` 立即 flush。
- 无 IPC 桥（浏览器模式/旧 preload）→ 不注册监听；主进程 metrics 未启用 → 返回 `accepted=0`，渲染层不重试。

### 4.6 配置单一真源与自检

- 变量名/默认值/作用域/敏感性唯一真源：`packages/shared/src/observability/env.ts`；运行时解析在同目录 `resolve.ts`。
- 优先级：运行时 env > 构建期 `__SENTRY_DSN__` > 代码默认值；遥测级别由 `telemetry-pref.json` 提供。
- `pnpm check:observability-config`：校验注册表 ↔ 代码 ↔ `.env.example` ↔ 运行手册 ↔ CI 无未知/缺失变量。
- `pnpm observability:doctor`：打印脱敏生效配置、校验格式、可选 OTLP 真实探测；`--release --offline` 用于发布前半配置断言。
- `pnpm observability:smoke`：启动真实 Electron + 本地 OTLP 接收器，断言 traces/metrics/logs 均能到达。
- SLO/告警定义在 `observability/slo.json`，`pnpm check:observability-slo` 校验指标名与运行手册覆盖。
- 设置页「遥测」区块展示 Sentry/OTel 状态、导出健康与「测试连接」；OTLP 发空载荷探测，Sentry 只校验 DSN 结构。

## 五、诊断包与排障

`app:exportDiagnostics` 导出：

- `manifest.json`：应用/运行时版本、平台、导出时间；
- `settings.json`：设置快照（`redactSensitive`）；
- `logs/*.log`：日志尾部（单文件 8MB，`redactText`）；
- `runtime.json`：自启、窗口状态、`observability` 快照（级别、OTel 各信号启用态、Sentry release/environment/reason、管道健康/丢弃计数；**不含 DSN/端点/请求头**）。

排障顺序：本地日志（traceId）→ 诊断包 → Sentry issue（有 DSN）→ SigNoz trace/metrics/logs（有端点）。

## 六、已知边界

1. 渲染层没有通用 OTel trace/log（只有错误转发与 Web Vitals）；这是为了不把 SDK/DSN 带进渲染层与 CSP。
2. 不包含产品分析（PostHog/OpenFeature/A-B 实验）与业务事件漏斗；需要时另立域并单独评审隐私。
3. Sentry 免费版配额有限（错误/span/日志分项），本模板默认只用错误与崩溃；自建 SigNoz 承担 trace/metrics/logs。
4. 原生崩溃符号化依赖可选 debug files 上传；未上传时仍能收到 minidump 与模块/偏移信息。
5. 本地日志写入时不做值级脱敏（保留排障细节），只在诊断包导出、Sentry beforeSend、OTel 导出三处脱敏；不要把密钥写进日志。

## 七、检查清单

- [ ] 新 span/metric 遵守命名与低基数属性；指标名走 `packages/shared/src/observability/metrics.ts`
- [ ] 新错误路径走 `error-report`，不要直接 `Sentry.capture*`
- [ ] 新增日志字段先确认不含凭据；OTel 属性会自动脱敏但本地日志不会
- [ ] 新增/改名环境变量 → 更新注册表、`.env.example`、运行手册并跑 `check:observability-config`
- [ ] DSN/端点缺失时功能可用（no-op）；`off` 时无网络外发
- [ ] 改动遥测级别语义 → 同步设置页 i18n 与本文件 §二
- [ ] 改动发布链路 → 验证 `sentry:sourcemaps` 跳过/上传两条路径与 `observability:doctor --release`
- [ ] 改动 SLO/告警 → 同步 `observability/slo.json`、运行手册并跑 `check:observability-slo`
