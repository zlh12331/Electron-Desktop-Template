# 本地可观测性后端（开发/验收用）

本目录只放**本地**可观测性栈的声明，不包含生产部署凭据。

| 路径 | 用途 |
|---|---|
| `signoz/casting.yaml` | SigNoz Foundry 部署声明（Docker Compose，UI 8080 / OTLP 4317+4318） |

启动、验证、SLO 与告警配置步骤见 [docs/guides/observability-runbook.md](../docs/guides/observability-runbook.md)。

说明：

- SigNoz 官方已弃用仓库自带的 `deploy/docker`，改用 Foundry（`foundryctl cast`）。
- 单机 compose 模式建议 ≥4GB 内存；首次拉取镜像需要较大磁盘与网络。
- 不要把 `casting.yaml` 里的数据卷目录提交到 Git（`.gitignore` 已忽略 `.tmp/`；Foundry 默认数据目录不在仓库内）。
