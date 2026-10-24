# 23 · 可观测性规范

> 当前实现：`src/main/infra/telemetry/`、主/渲染进程错误出口、shared 指标契约与可观测性脚本。
> 最后同步：2026-10-24。模板提供采集和验收能力，不等于生产告警、通知渠道或容量已经验收。

## 一、职责与默认值

| 通道 | 职责 | 启用条件 |
|---|---|---|
| electron-log | 本地事件与错误证据 | 始终启用；生产 info 及以上，开发 debug |
| Sentry | 错误聚合、会话健康、原生崩溃 | 用户选择非 off 且配置 DSN |
| OTel Trace | IPC、启动、更新调用链 | full；有 OTLP 端点，或开发模式 Console trace |
| OTel Metrics | IPC、启动、更新、资源、DB、Web Vitals | full 且配置 metrics 端点 |
| OTel Logs | 结构化日志检索 | full 默认 info；error-only 仅 error；需 logs 端点 |
| 诊断 ZIP | 脱敏配置/日志/运行快照 | 用户主动导出，不自动上传 |

新安装、偏好缺失或损坏时默认 **off**。用户在设置页主动选择 `error-only` / `full`；已有合法选择保留，不强制弹出同意弹窗。
配置后端不等于同意外发。Sentry 性能采样固定 0，性能信号归 OTel；不引入产品分析、功能开关、自动 heap snapshot 或持续 profiling。

本地日志路径：Windows/Linux `userData/logs/main.log`，macOS `~/Library/Logs/<appName>/main.log`。读取和诊断包通过 `app.getPath('logs')` 获取目录。

## 二、同意与有效配置

级别保存在 `telemetry-pref.json`，原子替换写入，主进程在初始化 SDK 前同步读取。修改后重启生效：

| 级别 | Sentry | Trace | Metrics | Logs |
|---|---|---|---|---|
| off | 不初始化 | 不初始化 | 不初始化 | 不初始化 |
| error-only | 有 DSN 时启用 | 关闭 | 关闭 | 有端点时仅 error |
| full | 有 DSN 时启用 | 采样 | 有端点时启用 | 有端点时按最低级别导出 |

设置页区分 `configuredLevel`（已保存选择）和 `level`（本次启动选择），不同则展示 `restartRequired`。不能把已保存 off 描述为已停止所有在途网络请求。渲染错误 IPC 额外按文件中的 off 拒绝新的转发；SDK 全部关闭需要重启。

变量注册表：`packages/shared/src/observability/env.ts`；纯解析：同目录 `resolve.ts`。

- 运行时环境优先；只有 Sentry DSN 支持构建期 `__SENTRY_DSN__` 后备值。
- `.env` 在 userData/CDP/Sentry 读取前加载，不覆盖已有进程环境。`APP_ENV_FILE` 可指定文件，空字符串禁用文件加载，供隔离验收使用。
- OTel 信号专用端点优先于 base URL；base 派生 `/v1/traces`、`/v1/metrics`、`/v1/logs`。
- DSN 缺失与 off 均为正常状态，不是初始化错误；没有任一端点的打包版 OTel 不外发。
- doctor 本地读取同一环境文件与开发 userData 偏好，可传 `--env-file=`、`--user-data=`、`--level=`；`--release` 不自动载入本地 `.env`，按显式 CI 环境和 full 模拟检查发布配置，不代表最终用户选择 full。
- 设置页 Sentry 配置校验复用启动时的有效配置，包含构建注入 DSN；不发送测试事件。

## 三、错误与隐私边界

### 3.1 错误出口

主进程 `reportError` 先写本地日志，再交 Sentry 捕获。渲染层通过 `electron-log/renderer` 保留本地错误，同时经 `telemetry:captureError` 转交 Sentry/OTel；没有直接从渲染层连接观测后端。

覆盖：IPC 内部异常与响应契约失败、DB 打开/完整性/恢复/迁移/启动备份、密钥库损坏、更新下载、窗口加载/进程崩溃、代理设置、启动失败。业务错误码不等于系统故障；IPC 可用性指标另行分类。

渲染错误转发每分钟最多 30 条。本地保留与远端接收是两个结果，`accepted` 不是“服务端已永久存储”。

### 3.2 本地字段与远端字段

- `reportError.fields` 和自定义本地 `message` 不传入 Sentry，也不经 logger 旁路传入 OTel；远端使用允许的 tags、组件栈和错误对象。
- 这不是“路径从不外发”的保证：错误 message/stack 本身可能包含文件路径。禁止调用方记录凭据；脱敏只是最后防线。
- 敏感键（包括对象/数组）先整体遮蔽，字符串再做值形态处理；OTel 属性在 JSON 序列化前处理键名，避免 `password=普通字符串` 漏掉。
- 循环引用、过深 cause 和不可读 getter 不应导致错误处理再次抛错。logger sink 失败不影响已写入的本地日志。
- Sentry `beforeSend` / `beforeBreadcrumb` 处理文本与结构；不附截图和 local variables。原生 minidump 不走文本脱敏，启用前由部署方明确二进制隐私与服务端清洗策略。

### 3.3 配额保护

Sentry 文本事件在 `beforeSend` 中做有界指纹去重和全局预算，同指纹 5 次/分钟、全局 60 次/分钟、最多 128 个指纹；被抑制数为 `health.suppressedErrors`。未处理/致命异常优先保留，不经过该预算；因此不承诺任意错误风暴的总网络流量都有固定上界，也不承诺原生附件受此限流。

## 四、Trace 与关联

- Provider：`NodeTracerProvider` + `BatchSpanProcessor` + `ParentBasedSampler`。根采样默认开发 1、打包 0.2；子 span 继承父决策。
- IPC：`ipc {channel}`，只记录通道/系统/请求 ID；`withSpan` 将失败响应标记为 ERROR，异常文本脱敏后记录。
- 启动：`app.startup` 为父 span，`db.init` / `window.create` 为子 span。根 span 等首次主窗口可显示且初始路由挂载后结束；30 秒无就绪信号以超时结束，避免无限悬挂。
- 更新：`update.check`、`update.download`；用户取消不标 ERROR。

`app.trace_id` 是 preload 为一次 IPC 生成的 UUID，**不是** OTel 的原生 traceId。处于活动 span 内的日志由 SDK 关联原生 traceId/spanId；Sentry 事件另带 `contexts.opentelemetry` 的合法 `trace_id`、`span_id`、`sampled`，方便按原生 ID 查询。它不是跨站自动跳转链接，也不是完整 W3C 跨进程 trace context 协议。

资源包括 service 名/版本/namespace、host 平台/架构、Node runtime、构建渠道/提交/时间。环境属性双写 `deployment.environment` 与 `.name`，兼容已验证的 SigNoz 查询。

## 五、指标与 SLO 口径

`packages/shared/src/observability/metrics.ts` 同时登记名称、仪表类型、单位、属性值域；采集端使用该单位，SLO 校验也读取同一份描述符。

| 指标 | 单位/类型 | 口径 |
|---|---|---|
| `ipc.server.requests` | 1 / Counter | outcome 与 failureClass；none/validation/business/system |
| `ipc.server.request.duration` | ms / Histogram | 请求整体耗时，同上维度 |
| `app.startup.duration` | ms / Histogram | services/window/ready-to-show/renderer-ready；foreground/hidden |
| `app.update.events` | 1 / Counter | 漏斗事件，不作为检查失败率分母 |
| `app.update.checks` | 1 / Counter | 每次有效检查结束一次；不含 unsupported/in-flight |
| `app.update.check.duration` | ms / Histogram | launch/manual/retry/long-session，success/error |
| `app.update.download.duration` | ms / Histogram | 每次下载终态一次，downloaded/cancelled/error |
| `nodejs.eventloop.delay` | ms / Histogram | 每个 5s 窗口的 p99，含正常样本；告警阈值不影响采集 |
| `nodejs.memory.growth` | MB / Histogram | 检测到持续增长时记录，不是全量内存分布 |
| `process.memory.usage` | By / Gauge | 主进程 rss/heap/external 等 |
| `electron.process.memory` / `.cpu` | By / percent / Gauge | Electron 进程类型与名称 |
| `app.db.recovery` | 1 / Counter | healthy/restored/rebuilt 结局 |
| `app.db.backup` / `.duration` | 1 / ms | 启动与手动备份，success/error |
| `app.renderer.crashes` | 1 / Counter | reason 白名单，recovery=reload/stopped |
| `web_vitals.{lcp,fcp,inp,ttfb,cls}` | ms；CLS 为 1 | rating/navigation.type，渲染层批量 IPC |

启动时间从 Node `performance.timeOrigin` 计起；不是操作系统点击图标到进程创建的时间。`renderer-ready` 是初始路由 DOM 提交及 effect 执行，不宣称所有异步数据加载完成；`ready-to-show` 表示 Electron 可以显示窗口，隐藏启动不能混入前台 SLO。重载和后续窗口不重复计入首次启动。

SLO v2 在 `observability/slo.json`：11 条目标、2 条独立计数告警。包含结构化 query/filter、分子过滤、窗口、最小样本数、目标方向及告警比较，不再使用自由字符串条件。

- IPC 错误率：system / (none + system)，不混入明确输入拒绝和业务错误；未明确豁免的错误码保守归 system。
- 更新失败率：检查 error / 有效检查总数，不用整个更新漏斗事件数。
- 备份目标：错误率 ≤0.01，等价成功率 ≥99%，不是 error-rate ≤0.99。
- 延迟数字统一 ms：300、3000、10000、200、2500、200；CLS 无量纲。
- 启动只选 foreground renderer-ready；下载延迟只选 downloaded；事件循环目标是“5s 窗口 p99 样本分布的 p99”，不是全部循环延迟的总体 p99。
- DB rebuilt 与 renderer recovery=stopped 使用独立 critical 计数告警，不用健康样本稀释。

比例先逐序列处理 counter reset/窗口 increase，再合并分子分母；百分位合并 histogram，不平均各实例百分位。无数据、分母为零或 minSamples 不足应显示“无数据/不足”，不是成功率 100%。

契约不是后端执行引擎，也不会自动下发告警。Sentry crash-free sessions 是外部指标，不能用 renderer crash counter 代算。后端配置与通知验收按运行手册执行。

## 六、导出、退出与本地 Collector

OTel 三信号分别初始化，某一路失败不撤掉另外两路。Logs 旁路最低级别、采样、限流与本地文件级别独立：info/debug 可采样、非 error 可限流，error 绕过这些策略不代表 SDK 队列/网络/磁盘绝不丢失。

Logs 最多 24 个属性（包含异常属性）；属性约 2Ki 字符、正文 8Ki 字符、栈 16Ki 字符，不等于严格 UTF-8 字节预算。周期指标默认 60s 导出；批处理是 SDK 进程内缓冲，不会自动重放本地 main.log。

常规退出先解绑日志旁路，再并行 forceFlush（三路各 3s 上限），随后并行 shutdown（三路各 3s 上限），最后本地日志最多等待 300ms。致命异常/启动失败走命名冲刷注册表，同时尽力冲刷 OTel、Sentry 与本地日志，2s 强退兜底。断电/强杀仍可能丢失末尾数据。

本地 Collector 配置及验收入口见 [运行手册](../guides/observability-runbook.md)：memory_limiter、batch、可重试错误重试、file_storage 发送队列；可选错误/慢 trace/概率尾采样。

- 要让尾采样看到全部候选，应用根采样须设为 1；头部已丢弃的数据无法恢复。默认不增加所有客户端的上传量。
- file_storage 只保护已进入发送队列的数据，不保护 SDK、batch 或待决尾采样内存。
- 重试不包括永久错误；入队失败也不等于已进入重试队列。无端到端 exactly-once 保证。
- 本机环回明文配置不是生产入口；生产须部署 TLS/鉴权、磁盘保护、容量与保留策略，多尾采样实例须 trace-ID 亲和。

## 七、验收与诊断

- `pnpm check:observability-config`：21 项变量的注册/示例/文档/CI 一致性。
- `pnpm check:observability-slo`：严格结构、仪表类型/单位、filter 值域、分子范围、阈值方向与文档 ID，不代表后端已部署。
- `pnpm observability:doctor --offline`：脱敏有效配置与格式；`--release --offline` 用于发布模拟。
- `pnpm observability:smoke`：隔离本机环境，真实 Electron 到本地 OTLP/Sentry 合成接收器，解析 JSON/事件结构；检查启动父子关系、指标、错误脱敏和级别边界。它不是云端事件/原生 minidump/符号化验收。
- 设置页：活动级别/待重启选择、三信号状态、导出与抑制计数、真实 OTLP 空载荷探测；Sentry 按有效 DSN 仅做结构校验。
- 诊断包：manifest、脱敏设置、平台日志尾部（每文件最多保留 8MB）、窗口/自启/可观测性运行快照。日志采集目前先读整个文件再截尾，不承诺只占用 8MB 读取内存。

## 八、明确保留的边界

1. 不采集通用渲染操作日志，不强加 PostHog/OpenFeature 或自动内存快照。
2. 本地日志仍是排障文件，不是安全审计账本；不全量写时脱敏，不保证异常风暴无磁盘压力。
3. 头部采样不能保证每个错误都有完整 trace；Sentry 事件中 sampled=false 只提供关联线索。
4. 原生附件隐私、服务端 TTL、云端可达性、符号化和通知渠道必须在实际部署中单独验收。
5. 本机 fault smoke 与单测不能替代生产容量压测和运行期 SLO 观察。
