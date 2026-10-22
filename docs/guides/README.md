# 操作指南（guides）

> 本目录收录**可执行的操作流程**：流水线怎么跑、版本怎么发、开源仓库怎么维护。
> 与 [../design/](../design/README.md)（写代码的规范）和 [../history/](../history/README.md)（一次性记录）分开维护。

| 文档 | 内容 | 状态 |
|---|---|---|
| [ci-cd.md](ci-cd.md) | 六平台 CI（质量）+ CD（产物与发版）分层；PR 门禁、构建矩阵、smoke 覆盖与更新元数据合并 | 现行流水线即文中 §3 形态（2026-09 重构后持续使用） |
| [oss-automation.md](oss-automation.md) | GitHub 开源项目自动化运维模型：单人维护、本机 agent、审批门控与分层能力（L0–L5） | L0 + L1 已实施；L2 设计就绪；L3–L5 按 §7 重启条件暂缓 |

相关根目录文档：

- [RELEASING.md](../../RELEASING.md)：发版 runbook（release-please → 合并 Release PR → CD 三平台构建 → 校验产物）
- [CONTRIBUTING.md](../../CONTRIBUTING.md)：提交规范与本地验证命令
- [SECURITY.md](../../SECURITY.md)：漏洞报告与安全基线入口

> 新增指南：写「读者照着做就能完成」的步骤，不写设计论证；设计论证放 `design/`，一次性实施证据放 `history/`。
