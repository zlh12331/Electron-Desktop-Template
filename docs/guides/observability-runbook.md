# 可观测性运行手册（Sentry + SigNoz）

> 面向维护者：把模板的可观测性从「代码已接入」变成「本机可验证、告警可配置」。
> 设计边界与信号清单见 [23 可观测性规范](../design/23-otel-spec.md)。
> 最后验证：2026-10-23（Windows 11 + Docker 29.4.3 + Foundry；验证记录见 §八）

---

## 一、拓扑与端口

```
Electron main ── Sentry(HTTPS) ───────────────► Sentry SaaS / self-hosted
      │
      ├── OTLP/HTTP :4318 ──► OTel Collector ──► SigNoz ClickHouse
      │     traces / metrics / logs
      │
      └── electron-log ──► userData/logs/main.log（本地兜底，导出诊断包时脱敏）

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

开发期推荐直接导出环境变量（不要提交 `.env`）：

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"
export OTEL_METRIC_EXPORT_INTERVAL="5000"   # 验收时缩短导出间隔；生产用默认 60000
export OTEL_LOG_LEVEL="info"
pnpm dev
```

启动日志应出现：

- `Sentry 未启用`（未配 DSN）或 `Sentry 已启用`
- `OpenTelemetry 初始化完成（OTLP exporter）`，字段 `tracing/metrics/logs` 为 true

## 三、验证清单（本地）

| 信号 | 操作 | 预期 |
|---|---|---|
| Trace | 打开设置/关于页，触发任意 IPC（如 `app:getInfo`） | SigNoz Traces 出现 `ipc app:getInfo`，服务名 `electron-desktop-template-dev` |
| Logs | 应用启动 / 切换设置 | SigNoz Logs 出现 `IPC 请求成功`、`应用启动`；`app.trace_id` 与 trace 对得上 |
| Renderer error | DevTools Console 执行 `setTimeout(() => { throw new Error('observability-verify') })` | 本地 `main.log` 有「渲染层错误上报」；SigNoz Logs 有 `renderer.error`（无 DSN 时 Sentry 不发送） |
| Metrics | 等待 ≥1 个导出周期 | Metrics 出现 `ipc.server.requests`、`process.memory.usage`；更新检查后出现 `app.update.events` |
| Web Vitals | 页面可见后等待 5s 或切后台 | Metrics 出现 `web_vitals.lcp` 等（无渲染时可能只出现部分指标） |
| 脱敏 | 在错误消息里带 `sk-...`/Bearer | 导出诊断包与后端日志中为 `[REDACTED]` |

> 渲染层错误风暴有 30 条/分钟限流；连续触发时 `accepted=false` 属预期。

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

> 下列阈值为模板起点，接入业务后按真实基线调整；改阈值时同步本表。
> 指标名以 OTel 原名为准；SigNoz 查询构建器/ PromQL 会把点转为下划线，以 UI 自动补全为准。

| SLO | 指标 / 公式 | 目标 | 告警 |
|---|---|---|---|
| Crash-free sessions | Sentry release health | ≥99.5%（7d） | <99% 持续 1h → critical |
| IPC 成功率 | `ipc.server.requests{outcome="success"}` / 总数 | ≥99.5%（1h） | 错误率 >1% 10m → warning；>5% 5m → critical |
| IPC 延迟 | `ipc.server.request.duration` p95 | ≤300ms（1h） | p95 >1s 10m → warning |
| 启动耗时 | `app.startup.duration{phase="window"}` p95 | ≤3s（1h） | p95 >5s 15m → warning |
| 更新检查成功率 | `app.update.check.duration{outcome!="network"}` / 总数 | ≥98%（24h） | 失败率 >5% 1h → warning |
| 下载耗时 | `app.update.download.duration` p95 | 按包体设定 | 连续 3 次超阈值 → warning |
| 事件循环 p99 | `nodejs.eventloop.delay` p99 | ≤200ms | >1s 5m → warning；>2s 5m → critical |
| 主进程内存增长 | `nodejs.memory.growth` >150MB 事件 | 0 次/日 | 任意事件 → warning |
| LCP | `web_vitals.lcp` p75 | ≤2.5s（24h） | >4s 30m → warning |
| INP | `web_vitals.inp` p75 | ≤200ms（24h） | >500ms 30m → warning |
| CLS | `web_vitals.cls` p75 | ≤0.1（24h） | >0.25 30m → warning |

SigNoz 配置路径（以当前 UI 为准）：

1. **Dashboards** → 新建面板，数据源选 Metrics，逐个添加上表指标；
2. **Alerts** → New Alert → Metric-based，按上表条件设置阈值与 `for` 窗口；
3. 通知渠道先接邮件/Webhook，生产环境再接值班工具。

## 六、排障

| 现象 | 排查 |
|---|---|
| SigNoz UI 打不开 | `docker ps` 看容器；首次启动 ClickHouse 初始化需要数十秒；端口被占用时改 `casting.yaml` 或释放 8080 |
| 应用日志显示 OTel 未初始化 | 检查 `OTEL_EXPORTER_OTLP_ENDPOINT` 是否在启动进程环境里；打包版必须配置端点 |
| 已初始化但后端无数据 | `OTEL_DIAG=1` 重启，观察 exporter 是否报连接/认证错误；`curl -X POST http://127.0.0.1:4318/v1/traces` 验证端点 |
| SigNoz 有 traces 无 logs | `OTEL_LOG_LEVEL` 是否高于日志级别；`error-only` 只导出 error；检查 `LoggerProvider` 初始化日志 |
| 无 Web Vitals | 浏览器模式无 IPC 桥属预期；页面未产生 LCP/INP 时对应指标缺失；确认 `OTEL_METRIC_EXPORT_INTERVAL` |
| Sentry 无事件 | `SENTRY_DSN` 是否生效（启动日志 reason）；`off` 级别；网络/代理；Sentry 项目配额 |
| Source map 未生效 | release 是否与运行时一致；上传日志是否成功；`out/` 是否被重新构建且未上传 |

## 七、隐私与保留

- 本地日志写入时保留排障细节；诊断包导出、Sentry `beforeSend`、OTel 导出三处脱敏。
- 不采集：用户输入正文、凭据、窗口标题全文；Sentry 不附加截图、不采集 local variables。
- minidump 为二进制附件，不经过 `beforeSend`；启用原生崩溃上报前需确认组织的数据处理要求。
- 后端保留策略由部署方设置；本地 compose 数据默认仅在本机。
- 用户可在设置页把遥测切到 `off`（重启生效），或直接删除 `telemetry-pref.json` 回到默认 `full`。

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

未验证（需外部凭据/服务）：

- Sentry 真实事件、source map 控制台反解与原生符号化（无 DSN / AUTH_TOKEN）。
- 生产后端、跨网络采样率与保留策略（本地 compose 不代表生产容量）。
- SigNoz 告警通知通道（本地未配置邮件/Webhook）。

验证截图（本地临时目录，不入仓）：`.tmp/signoz-services.png`、`.tmp/signoz-traces.png`、`.tmp/signoz-logs.png`。

> 记录只写实际观察到的结果；未验证的项保持「未验证」。

### 8.1 验证后清理

```bash
# 停止应用（若仍在运行）
# Ctrl-C 结束 pnpm dev；Windows 若端口 9222/5173 仍被占用，用 netstat 找到 PID 后 taskkill
# 停止 SigNoz（保留数据卷；加 -v 会删除数据）
docker compose -f .tmp/signoz-pours/deployment/compose.yaml down
```

`.tmp/` 下的 pours、日志与截图均被 `.gitignore` 忽略，不会进入提交。
