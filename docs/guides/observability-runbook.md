# 可观测性运行手册（Sentry + SigNoz）

> 面向维护者：把模板的可观测性从「代码已接入」变成「本机可验证、告警可配置」。
> 设计边界与信号清单见 [23 可观测性规范](../design/23-otel-spec.md)。
> 最后验证：2026-10-24（Windows 11 + Docker 29.4.3 + Foundry + Collector 0.163.2；验证记录见 §八）

---

## 一、拓扑与端口

```
Electron main ── Sentry(HTTPS) ───────────────► Sentry SaaS / self-hosted
      │
      ├── OTLP/HTTP :4318 ──► OTel Collector ──► SigNoz ClickHouse
      │     traces / metrics / logs
      │
      └── electron-log ──► 平台日志目录/main.log（Win/Linux userData/logs，macOS ~/Library/Logs/<app>；导出诊断包时脱敏）

Electron renderer ── telemetry:captureError / reportWebVitals ──► main（不直连后端）
```

- SigNoz UI：`http://localhost:8080`
- OTLP gRPC：`4317`；OTLP HTTP：`4318`
- 单机 compose 建议 ≥4GB 可用内存；首次启动拉取镜像较慢。

## 二、本地 SigNoz（Foundry）

### 2.1 前置

1. Docker Desktop 已启动：`docker version` 能看到 Server 版本。
2. 安装 Foundry CLI（官方脚本会校验 GitHub Release 二进制）：

   ```bash
   curl -fsSL https://signoz.io/foundry.sh -o /tmp/foundry.sh
   bash /tmp/foundry.sh -y
   ```

   Windows Git Bash 下安装到 `~/.local/bin/foundryctl`；把该目录加入 PATH 后验证：

   ```bash
   foundryctl --help
   ```

3. 内存/磁盘：首次 `cast` 会拉取 SigNoz、ClickHouse、Collector 等镜像。

### 2.2 启动

仓库内置声明文件 [observability/signoz/casting.yaml](../../observability/signoz/casting.yaml)：

```bash
# -p 把生成的 compose/配置放到被 .gitignore 忽略的 .tmp，避免污染仓库
mkdir -p .tmp/signoz-pours
foundryctl cast -f observability/signoz/casting.yaml -p .tmp/signoz-pours --no-updater
```

启动完成后：

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -fsS http://localhost:8080/ >/dev/null && echo "SigNoz UI OK"
```

停止（默认保留数据卷；加 `-v` 才会删除数据）：

```bash
# Foundry v0.3.0 生成的 compose 文件在 pours 目录；直接用它停栈（加 -v 会删数据卷）
docker compose -f .tmp/signoz-pours/deployment/compose.yaml down
```

### 2.3 让应用指向本地栈

新安装默认 off；先在「设置 → 通用 → 遥测」选择 full，再重启。配置端点本身不会替用户同意采集。开发期可使用以下 PowerShell 命令（不要提交实际 `.env`）：

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
$env:OTEL_METRIC_EXPORT_INTERVAL = "5000" # 验收时缩短间隔，日常默认 60000
$env:OTEL_LOG_LEVEL = "info"
pnpm dev
```

启动日志应出现：
- `Sentry 未启用`（未配 DSN）或 `Sentry 已启用`
- `OpenTelemetry 初始化完成（OTLP exporter）`，字段 `tracing/metrics/logs` 为 true

### 2.4 配置参考（单一真源）

变量名、默认值、作用域与敏感性唯一真源：[packages/shared/src/observability/env.ts](../../packages/shared/src/observability/env.ts)；
`pnpm check:observability-config` 会校验代码、`.env.example`、本表与 CI 不漂移。

| 变量                                  | 作用域               | 默认值                        | 重启生效 | 说明                                        |
| ------------------------------------- | -------------------- | ----------------------------- | -------- | ------------------------------------------- |
| `SENTRY_DSN`                          | runtime / build      | 无                            | 是       | 运行时优先于构建期注入；未配置 Sentry no-op |
| `SENTRY_ENVIRONMENT`                  | runtime              | production / development      | 是       | Sentry 环境标签                             |
| `SENTRY_RELEASE`                      | runtime / build / ci | `{executableName}@{version}`  | 是       | 运行时与上传必须一致                        |
| `SENTRY_AUTH_TOKEN`                   | build / ci           | 无                            | 否       | source map / debug files 上传令牌（敏感）   |
| `SENTRY_ORG`                          | build / ci           | 无                            | 否       | Sentry 组织 slug                            |
| `SENTRY_PROJECT`                      | build / ci           | 无                            | 否       | Sentry 项目 slug                            |
| `SENTRY_UPLOAD_DISABLED`              | build / ci           | 无                            | 否       | 置 1 跳过 source map 上传                   |
| `SENTRY_UPLOAD_DEBUG_FILES`           | ci                   | 0                             | 否       | 置 1 上传原生调试符号                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | runtime              | 无                            | 是       | OTLP base URL，自动派生 `/v1/*`             |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | runtime              | 无                            | 是       | trace 专用端点                              |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | runtime              | 无                            | 是       | metrics 专用端点                            |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`    | runtime              | 无                            | 是       | logs 专用端点                               |
| `OTEL_EXPORTER_OTLP_HEADERS`          | runtime              | 无                            | 是       | OTLP 请求头（敏感）                         |
| `OTEL_SERVICE_NAME`                   | runtime              | `{executableName}-prod/dev`   | 是       | 后端服务名                                  |
| `OTEL_TRACES_SAMPLER`                 | runtime              | parentbased_traceidratio      | 是       | always_on / always_off / traceidratio       |
| `OTEL_TRACES_SAMPLER_ARG`             | runtime              | dev=1 / prod=0.2              | 是       | 根 span 采样率 0..1                         |
| `OTEL_LOG_LEVEL`                      | runtime              | info（error-only 固定 error） | 是       | 日志导出最低级别                            |
| `OTEL_LOG_SAMPLE_RATIO`               | runtime              | 1                             | 是       | info/debug 采样率；warn/error 不采样        |
| `OTEL_LOG_MAX_PER_MINUTE`             | runtime              | 0（不限）                     | 是       | 非 error 日志每分钟上限                     |
| `OTEL_METRIC_EXPORT_INTERVAL`         | runtime              | 60000                         | 是       | 指标导出间隔毫秒（1000..600000）            |
| `OTEL_DIAG`                           | runtime              | 关                            | 是       | 置 1 输出 OTel SDK 排障日志                 |

### 2.5 配置自检与连接测试

```bash
pnpm observability:doctor                 # 生效配置 + 格式校验 + OTLP 真实探测
pnpm observability:doctor --offline       # 只做静态校验
pnpm observability:doctor --release --offline  # CI 发布前：半配置上传凭据 fail
pnpm observability:doctor --json          # 机器可读输出
```

本地 doctor 读取应用相同的 `.env` 和开发 userData 偏好，可用 `--env-file=<path>`、`--user-data=<path>`、`--level=<level>` 指定；`APP_ENV_FILE` 为空表示不加载文件。`--release` 默认不载入本机 `.env`，按 CI 进程环境模拟 full 以发现半配置，不代表安装用户已同意遥测。`--json` 只输出一个 JSON 文档。

设置页「遥测」展示活动级别与待重启选择、Sentry/OTel 状态、导出健康与 Sentry 重复/配额抑制数，页面挂载时定期刷新：
- OTLP：发送空 resource 载荷验证可达/鉴权，不产生业务数据；
- Sentry：只校验 DSN 结构，不发送测试事件。

### 2.6 本地持久中继 Collector（可选）

仓库提供与 SigNoz 解耦的持久中继配置：[collector.yaml](../../observability/collector/collector.yaml)、[compose.yaml](../../observability/collector/compose.yaml)、[tail-sampling.yaml](../../observability/collector/tail-sampling.yaml)。固定 `otel/opentelemetry-collector-contrib:0.163.2`；`0.163.0` 的发布资产不含 contrib，不能沿用旧标签。

```powershell
docker compose -p otel-relay -f observability/collector/compose.yaml up -d
# 应用改为指向中继（仍需设置页选择 full 并重启）
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:14318"
$env:OTEL_TRACES_SAMPLER = "always_on"  # 仅当需要尾采样覆盖全部候选
pnpm dev
```

- 中继只发布环回端口：OTLP HTTP `14318`、自身指标 `18888`；容器内无外网。
- 队列使用 `file_storage`，`queue_size` 单位是请求批次；`max_size` 是每个数据库文件上限。只有已入发送队列的数据可跨 SIGKILL 恢复；SDK、batch 和尾采样待决缓冲不在其中。
- 默认不启用尾采样。可选 overlay 保留 ERROR、1500ms 以上慢 trace，其余 10%；客户端 head drop 的数据无法恢复，多实例尾采样需要按 trace ID 亲和。
- 生产入口需自行部署 TLS/鉴权、磁盘加密、容量与多实例隔离；本地环回明文不是生产部署模板。

自动化验收（只创建带专属 label/随机前缀的本地资源，结束清理；不读真实 `.env` 或遥测）：

```powershell
pnpm observability:collector-smoke
```

它先对三份配置和合成 sink 执行 `validate`，再验证三信号、下游断开、队列非空稳定、SIGKILL 后同卷恢复、下游恢复后全部合成 ID 到达并排空，以及尾采样保留/丢弃策略。只有真实容器步骤全部通过才返回0。

SigNoz 保留期入口以目标版本 UI 为准：**Settings → Workspace → Retention Controls**（Logs/Traces/Metrics 各自设置）。正式环境不要照搬本地默认天数，也不要在仓库维护 ClickHouse TTL DDL。

## 三、验证清单（本地）

| 信号           | 操作                                                                                  | 预期                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Trace          | 打开设置（关于或 Beta），触发任意 IPC（如 `app:getInfo`）                             | SigNoz Traces 出现 `ipc app:getInfo`，服务名 `electron-desktop-template-dev`                                         |
| Logs           | 应用启动 / 切换设置                                                                   | info 可见「应用启动」「设置已更新」；IPC 成功明细仅在 `OTEL_LOG_LEVEL=debug` 时导出；活动 span 的原生 traceId 可关联 |
| Renderer error | DevTools Console 执行 `setTimeout(() => { throw new Error('observability-verify') })` | 本地 `main.log` 有「渲染层错误上报」；SigNoz Logs 有 `renderer.error`（无 DSN 时 Sentry 不发送）                     |
| Metrics        | 等待 ≥1 个导出周期                                                                    | Metrics 出现 `ipc.server.requests`、`process.memory.usage`；更新检查后出现 `app.update.events`                       |
| Web Vitals     | 页面可见后等待 5s 或切后台                                                            | Metrics 出现 `web_vitals.lcp` 等（无渲染时可能只出现部分指标）                                                       |
| 脱敏           | 在错误消息里带 `sk-...`/Bearer                                                        | 导出诊断包与后端日志中为 `[REDACTED]`                                                                                |

> 渲染层错误风暴有 30 条/分钟限流；连续触发时 `accepted=false` 属预期。

自动化验证（无需 SigNoz）：

```bash
pnpm build              # 需要 out/main + out/renderer
pnpm observability:smoke
```

脚本使用专属临时 userData、明确的用户选择和三信号环回端点，禁用本机 `.env` 与继承的后端配置。按 OTLP JSON 字段验证启动父子 trace、renderer-ready、指标和脱敏错误，并用本地 Sentry 合成接收器验收事件；off/error-only/full 分别验证。只有全部断言通过才返回0。它不验证 Sentry 云端、原生 minidump 或 source map 反解。

## 四、Sentry（可选）

### 4.1 项目与 DSN

1. Sentry 新建 Electron 项目，拿到 DSN。
2. 本地：`SENTRY_DSN=... pnpm dev`。
3. 发布：在 GitHub Secrets 配置 `SENTRY_DSN`，构建期注入为默认值；运行时 `SENTRY_DSN` 仍可覆盖。
4. 验证：主进程抛错 / 渲染层触发错误，Sentry Issues 出现事件；release 为 `{executableName}@{version}`。

### 4.2 Source map（必须）

在 GitHub Secrets 配置：
- `SENTRY_AUTH_TOKEN`（project release 写权限）
- `SENTRY_ORG`
- `SENTRY_PROJECT`

`pnpm build:win:x64` 等打包脚本会先执行 `pnpm sentry:sourcemaps`：
1. `releases new` → `sourcemaps inject out`（写 debug id）→ `sourcemaps upload` → `releases finalize`；
2. 三项凭据任一缺失 → 打印跳过原因并继续（本地构建不失败）；
3. 注入/上传失败 → 构建失败（避免发布无法符号化的版本）。

原生调试符号（可选）：仓库变量 `SENTRY_UPLOAD_DEBUG_FILES=1`，CD 会执行
`pnpm sentry:debug-files`（上传 `release/*-unpacked`，体积大、耗时明显）。

### 4.3 建议告警

- 新 issue（首次出现）→ 即时通知
- 错误率/事件量突增（spike）→ 15 分钟窗口
- crash-free sessions < 99.5%（7 天）→ 每日
- 回归（regression：已解决版本再次出现）→ 即时

## 五、SLO 与告警（SigNoz）

> **模板交付边界**：仓库提供信号定义、Collector 参考配置、SLO 契约与本地验收脚本；生产 Collector / 存储 / 告警通知的部署与容量由接入方负责，模板不包含可直接运维的后端。
>
> 下列阈值为模板起点，接入业务后按真实基线调整；改阈值时同步本表。
> 指标名以 OTel 原名为准；SigNoz 查询构建器/ PromQL 会把点转为下划线，以 UI 自动补全为准。

机器可读 v2 契约在 [observability/slo.json](../../observability/slo.json)。校验覆盖类型、单位、属性值域、分子/分母关系、阈值方向与文档 ID；不代表后端查询或通知已经部署。时间阈值全部使用仪表原单位 **ms**，比例/CLS 使用 **1**，后端不得直接按秒数比较。

| ID                          | 指标 / 公式                                                  | 目标                | 告警                       |
| --------------------------- | ------------------------------------------------------------ | ------------------- | -------------------------- |
| `crash-free-sessions`       | 外部 Sentry Release Health，7d                               | ≥0.995              | <0.99 持续 1h → critical   |
| `ipc-error-rate`            | `ipc.server.requests`：system error / (none + system)，1h    | ≤0.005              | >0.05 持续 5m → critical   |
| `ipc-p95-latency`           | `ipc.server.request.duration` 全请求 p95，1h                 | ≤300ms              | >1000ms 持续 10m → warning |
| `startup-p95`               | `app.startup.duration`，foreground + renderer-ready，p95，1h | ≤3000ms             | >5000ms 持续 15m → warning |
| `update-check-failure`      | `app.update.checks` error / total，24h                       | ≤0.02               | >0.05 持续 1h → warning    |
| `update-download-p95`       | `app.update.download.duration`，仅 downloaded，p95，24h      | ≤10000ms            | >30000ms 持续 1h → warning |
| `db-backup-success`         | `app.db.backup` error / total，24h                           | ≤0.01（成功率≥99%） | >0.05 持续 1h → warning    |
| `event-loop-p99`            | `nodejs.eventloop.delay` 的5秒窗口 p99 样本分布 p99，5m      | ≤200ms              | >2000ms 持续 5m → critical |
| `web-vitals-lcp`            | `web_vitals.lcp` p75，24h                                    | ≤2500ms             | >4000ms 持续 30m → warning |
| `web-vitals-inp`            | `web_vitals.inp` p75，24h                                    | ≤200ms              | >500ms 持续 30m → warning  |
| `web-vitals-cls`            | `web_vitals.cls` p75，24h                                    | ≤0.1                | >0.25 持续 30m → warning   |
| `db-recovery-rebuilt`       | `app.db.recovery{outcome=rebuilt}`，5m increase              | 独立事故告警        | >0 持续 1m → critical      |
| `renderer-recovery-stopped` | `app.renderer.crashes{recovery=stopped}`，5m increase        | 独立事故告警        | >0 持续 1m → critical      |

`query.minSamples` 必须一起配置：比例取分母事件数，百分位取观测数，独立告警取筛选后的事件数。缺数据、分母为0、样本不足不能解释为健康。比例逐序列计算 counter reset 后的窗口 increase 再汇总；百分位合并 histogram，不平均各实例 p95。`alert.for` 为持续越界时间，不是采样窗口。

新增属性会生成新时间序列；部署切换期不能把没有 failureClass 的旧数据硬当 system/none，历史口径不可直接拼接。启动指标是 Node 进程时钟到初始路由提交，不包含启动器启动进程之前的时间；hidden 启动被排除。事件循环样本不是总体 p99 原始分布。

`nodejs.memory.growth` 与 `app.db.backup.duration` 保留为诊断趋势，不强行给每个指标设告警。

SigNoz 配置路径（以当前 UI 为准）：
1. **Dashboards** → 新建面板，数据源选 Metrics，逐个添加上表指标；
2. **Alerts** → New Alert → Metric-based，按上表条件设置阈值与 `for` 窗口；
3. 通知渠道先接邮件/Webhook，生产环境再接值班工具。

## 六、排障

| 现象                       | 排查                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SigNoz UI 打不开           | `docker ps` 看容器；首次启动 ClickHouse 初始化需要数十秒；端口被占用时改 `casting.yaml` 或释放 8080            |
| 应用日志显示 OTel 未初始化 | 检查 `OTEL_EXPORTER_OTLP_ENDPOINT` 是否在启动进程环境里；打包版必须配置端点                                    |
| 已初始化但后端无数据       | `OTEL_DIAG=1` 重启，观察 exporter 是否报连接/认证错误；`curl -X POST http://127.0.0.1:4318/v1/traces` 验证端点 |
| SigNoz 有 traces 无 logs   | `OTEL_LOG_LEVEL` 是否高于日志级别；`error-only` 只导出 error；检查 `LoggerProvider` 初始化日志                 |
| 无 Web Vitals              | 浏览器模式无 IPC 桥属预期；页面未产生 LCP/INP 时对应指标缺失；确认 `OTEL_METRIC_EXPORT_INTERVAL`               |
| Sentry 无事件              | `SENTRY_DSN` 是否生效（启动日志 reason）；`off` 级别；网络/代理；Sentry 项目配额                               |
| Source map 未生效          | release 是否与运行时一致；上传日志是否成功；`out/` 是否被重新构建且未上传                                      |

## 七、隐私与保留

- 本地日志写入时保留排障细节；诊断包导出、Sentry `beforeSend`、OTel 导出三处脱敏。
- 不采集：用户输入正文、凭据、窗口标题全文；Sentry 不附加截图、不采集 local variables。
- minidump 为二进制附件，不经过 `beforeSend`；启用原生崩溃上报前需确认组织的数据处理要求。
- 后端保留策略由部署方设置；本地 compose 数据默认仅在本机。
- 用户可在设置页切换级别（重启生效）；偏好缺失/损坏时回到 off。已保存选择与当前活动级别分别显示，不把保存成功等同于已停止所有在途外发。
- Sentry 文本事件有同指纹5/min、总60/min预算，致命/未处理事件豁免；被抑制数可在状态页查看，原生附件不受该闸保护。

## 八、本地验证记录

**2026-10-23 · Windows 11 · Docker 29.4.3 · Foundry v0.3.0 · SigNoz v0.147.0**

已验证：
1. `foundryctl cast -f observability/signoz/casting.yaml -p .tmp/signoz-pours --no-updater` 启动成功；`http://localhost:8080` 返回 200，容器含 `signoz-signoz-0` / `signoz-ingester-1` / ClickHouse / Postgres。
2. 应用以 `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` 启动，日志出现：
   - `Sentry 未启用（reason: no-dsn）`（未配 DSN 的 no-op 分支）
   - `OpenTelemetry 初始化完成（OTLP exporter）`，`tracing/metrics/logs` 均为 true
3. SigNoz Home 显示 **Logs / Traces / Metrics ingestion is active**。
4. Services 页出现 `electron-desktop-template-dev`（P99 ≈5.13ms，错误率 0%，OPS ≈0.01）。
5. Traces 列表出现 `ipc app:getInfo`、`ipc telemetry:captureError`、`ipc telemetry:reportWebVitals` 等 span。
6. Logs 列表出现 `渲染层错误上报`（ERROR）、`IPC 请求成功`、`应用启动` 等；`resources_string['service.name']` 正确。
7. ClickHouse 直接核对：
   - `signoz_traces.distributed_signoz_index_v3` 有 24 行 span；
   - `signoz_logs.distributed_logs_v2` 有 109 行日志；
   - `signoz_metrics.distributed_samples_v4` 有 `ipc.server.requests`、`ipc.server.request.duration.*`、`process.memory.usage`、`electron.process.memory/cpu`、`web_vitals.fcp.*`、`web_vitals.ttfb.*`。
8. 关键兼容修正：SigNoz v0.147 仍读取 `deployment.environment`；资源属性同时写入
   `deployment.environment` 与 `deployment.environment.name`，否则 Services/Explorer 的环境过滤看不到数据。

**2026-10-24 本地 Collector 故障验收通过**：`otel/opentelemetry-collector-contrib:0.163.2` 四组 `validate` 通过；三信号基线到达合成 sink；停 sink 后发送 4608 个合成 ID，三队列稳定非空，SIGKILL 后用同卷重启，恢复 sink 后全部 ID 到达且队列归零；尾采样保留 ERROR/1500ms、丢弃 0% 正常样本；隔离资源已清理，既有容器未改变。

未验证（需外部凭据/服务）：
- Sentry 真实事件、source map 控制台反解与原生符号化（无 DSN / AUTH_TOKEN）。
- 生产后端、跨网络采样率与保留策略（本地 compose 不代表生产容量）。
- SigNoz 告警通知通道（本地未配置邮件/Webhook）。

验证截图（本地临时目录，不入仓）：`.tmp/signoz-services.png`、`.tmp/signoz-traces.png`、`.tmp/signoz-logs.png`。

> 记录只写实际观察到的结果；未验证的项保持「未验证」。

### 8.1 配置治理补验（2026-10-24）

- `pnpm check:observability-config` 通过：21 个变量在注册表、代码、`.env.example`、本手册与 CI 一致。
- `pnpm check:observability-slo` 通过：11 条 SLO 定义合法且本手册覆盖全部 id。
- `pnpm observability:doctor --offline` 通过；`SENTRY_AUTH_TOKEN` 半配置时
  `pnpm observability:doctor --release --offline` 按预期 fail。
- `pnpm observability:smoke`（真实 Electron + 本地 OTLP 接收器）通过：traces/metrics/logs
  各至少 1 次到达，启动 span 与 DB 恢复指标已在载荷中；同时验证 `telemetry:getStatus` 与
  `telemetry:testConnection` IPC 正常。
- 设置页状态卡/连接测试由组件测试覆盖（`telemetry-status-card.test.tsx`）。

### 8.2 验证后清理

```bash
# 停止应用（若仍在运行）
# Ctrl-C 结束 pnpm dev；Windows 若端口 9222/5173 仍被占用，用 netstat 找到 PID 后 taskkill
# 停止 SigNoz（保留数据卷；加 -v 会删除数据）
docker compose -f .tmp/signoz-pours/deployment/compose.yaml down
```

`.tmp/` 下的 pours、日志与截图均被 `.gitignore` 忽略，不会进入提交。
