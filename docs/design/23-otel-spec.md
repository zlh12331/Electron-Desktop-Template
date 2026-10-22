# 23 · 可观测性规范（OTel 与日志分工）

> 基于 `src/main/infra/telemetry/otel.ts` 与 `src/main/utils/error-report.ts` 的实际实现。
> 最后同步：2026-10-22（模板版：按当前 span 消费现状重写）

---

## 一、通道总览

| 维度 | 工具 | 职责 | 落点 |
|---|---|---|---|
| 文本日志 | electron-log + traceId | 逐条事件 / 错误详情（落盘，随诊断包导出） | `userData/logs/main.log` |
| 追踪 | OpenTelemetry（OTLP/HTTP） | 跨步骤调用链（当前模板**尚未产生 span**，见 §二） | 未配置端点不外发 |
| 错误出口 | error-report | 异常汇聚 → 本地日志 + GitHub Issue 深链 | `src/main/utils/error-report.ts` / `src/renderer/lib/error-report.ts` |

Sentry 已于 2026-09-13 移除（生产链路本就不通、隐私面不可控、本地证据链已完整）。将来若接错误聚合服务，只改两个 error-report 出口文件，调用方不变。

## 二、追踪（Trace）

### 2.1 当前实现

- `initTelemetry()` 在启动序列中调用：**遥测级别为 `off`** → 不初始化；**打包版且未配置 `OTEL_EXPORTER_OTLP_ENDPOINT`** → 不初始化；dev 无端点 → `ConsoleSpanExporter`（本地观察）；配置端点 → `OTLPSpanExporter`。
- `withSpan(name, attributes, fn)` 已提供（未初始化时直接执行 fn，零开销；失败不影响主流程），但**模板当前没有业务调用方**——即不产生任何 span。
- IPC handler 不自动建 span：`wrap()` 只做 traceId 日志与契约校验。
- 遥测设置当前只有 `off` 与非 `off` 的差异（`error-only` / `full` 尚无行为分支）——接入 span 后需落实「error-only 仅导出错误 span」的语义，再在设置页宣称该能力。

### 2.2 命名与属性约定（接入时遵守）

```
格式：<domain>.<operation>
示例（业务接入后）：
  db.query           # 数据库查询
  http.request       # 外部 HTTP 调用
  update.check       # 更新检查
```

- 首字母小写 + 点分隔；禁止空格 / 斜杠。
- 属性只放低基数、非敏感字段（`channel`、`domain`、`host.platform` 等）；**禁止**入参 payload、prompt 全文、命令全文、凭据 / Token。
- 高频事件（逐字节流式输出、滚动）不建 span，防噪声。
- span 属性 `trace_id` 与 electron-log 的 `traceId` 对齐，支持日志 ↔ 追踪互查。

## 三、日志与错误的边界

- **能预期且可恢复**：返回 `AppError`（code + statusCode），由调用方决定提示；不写 error 级日志。
- **未预期**：error 级日志（带 stack + traceId）并交 error-report 出口。
- **诊断包**：日志 + 版本信息 + 自启/窗口状态打包为 zip（`app:exportDiagnostics`），报障走 GitHub Issue。
- **禁止**：日志输出密钥、Token、明文设置值。

## 四、指标（未启用）

当前不启用 OTel Metrics。触发条件：出现容量 / 成本分析需求（如请求量、错误率、缓存命中率）时再引入，避免无消费方的埋点。

## 五、检查清单

- [ ] 新增 span：`<domain>.<operation>` + 低基数属性 + 无敏感数据
- [ ] 高频事件不进 span
- [ ] 错误走 error-report 单一出口；日志含 traceId
- [ ] 未配置 OTLP 端点时零外发
- [ ] 若修改遥测级别语义，同步设置页文案与本文
