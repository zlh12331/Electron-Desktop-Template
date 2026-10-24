# 操作指南（guides）

> 本目录收录**可执行的操作流程**：流水线怎么跑、版本怎么发、开源仓库怎么维护。
> 与 [../design/](../design/README.md)（写代码的规范）和 [../history/](../history/README.md)（一次性记录）分开维护。

| 文档 | 内容 | 状态 |
|---|---|---|
| [ci-cd.md](ci-cd.md) | 六平台 CI（质量）+ CD（产物与发版）分层；PR 门禁、构建矩阵、smoke 覆盖与更新元数据合并 | 现行流水线即文中 §3 形态；`v1.3.x` 数据为历史证据，当前发版口径见 RELEASING |
| [template-acceptance.md](template-acceptance.md) | 干净副本验收：初始化、全新安装、启动/持久化、打包与 smoke；隔离与清理要求 | 模板底座改动后必跑；源仓库门禁不能替代 |
| [oss-automation.md](oss-automation.md) | GitHub 开源项目自动化运维模型：单人维护、本机 agent、审批门控与分层能力（L0–L5） | L0 + L1 已实施；L2 就绪；L3–L5 暂缓 |
| [observability-runbook.md](observability-runbook.md) | 配置参考、doctor/烟测、本地 SigNoz（Foundry）+ Sentry + Collector 持久中继、SLO/告警与排障 | 本地验证流程；生产后端由使用者自建 |
| [updating-from-template.md](updating-from-template.md) | 从上游模板同步修复与门禁：remote、差异审查、品牌/业务冲突边界、同步后验证 | 派生项目按需执行；品牌真源与业务文件不直接覆盖 |
| [dependency-policy.md](dependency-policy.md) | Node 26 LTS 支持矩阵、更新节奏、安全补丁、major 评审、beta 禁令与 override 生命周期 | 依赖升级与 override 变更前必读 |

相关根目录文档：

- [RELEASING.md](../../RELEASING.md)：发版 runbook（release-please → 合并 Release PR → CD 六架构构建 → 校验产物）
- [CONTRIBUTING.md](../../CONTRIBUTING.md)：提交规范与本地验证命令
- [SECURITY.md](../../SECURITY.md)：漏洞报告与安全基线入口

> 新增指南：写「读者照着做就能完成」的步骤，不写设计论证；设计论证放 `design/`，一次性实施证据放 `history/`。
