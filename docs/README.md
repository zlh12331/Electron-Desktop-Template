# 文档

本仓库是一个**通用 Electron 桌面模板**：底座（IPC 契约、设置持久化、四层状态、打包更新、质量门禁）已就绪，业务页面由接入方替换。
文档按「读它的时机」分三层，避免规范与历史混在一起：

| 目录                          | 回答的问题                                            | 维护方式                                         |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| [design/](design/README.md)   | 为什么这样设计？写代码必须遵守什么？                  | 长期有效；代码变更涉及某篇规范时**同一 PR 更新** |
| [guides/](guides/README.md)   | 怎么发版？CI 怎么跑？模板怎么验收？开源仓库怎么运维？ | 长期有效；操作流程变化时更新                     |
| [history/](history/README.md) | 某个功能当时怎么设计、踩了什么坑？                    | 一次性记录；写完冻结，不回填后续演进             |

## 先读哪几篇

- **第一次接触模板**：根 [README](../README.md) → [01 架构](design/01-architecture.md) → [03 目录结构](design/03-directory-structure.md) → [模板约束机器](design/template-architecture.md)
- **要加一个功能**：[AGENTS.md](../AGENTS.md)「扩展点速查」→ [19 IPC](design/19-ipc-spec.md) / [18 数据层](design/18-data-layer-spec.md) / [21 状态管理](design/21-state-management-spec.md) → [32 三阶段流程](design/32-feature-workflow-spec.md)
<!-- notes-example:start -->
- **要看完整业务链路怎么串**：[Local Notes 参考切片](design/notes-example.md)（默认由 `init:template` 删除）
<!-- notes-example:end -->
- **要改界面**：[09 前端实现](design/09-ux-interaction-spec.md) → [10 组件规范](design/10-component-design-spec.md) → [08 UX 规范](design/08-ux-guidelines.md) → [11 a11y](design/11-a11y-spec.md) / [12 性能](design/12-performance-spec.md)
- **要发版 / 改流水线**：[guides/ci-cd.md](guides/ci-cd.md) → [RELEASING.md](../RELEASING.md)
- **要验收模板底座**：[guides/template-acceptance.md](guides/template-acceptance.md)（干净副本 → 初始化 → 启动/持久化 → 打包 smoke）
- **要接可观测性 / 查告警**：[23 可观测性规范](design/23-otel-spec.md) → [observability-runbook.md](guides/observability-runbook.md)（本地 SigNoz、Sentry 凭据、SLO 与告警）
- **要把模板交给团队**：[guides/oss-automation.md](guides/oss-automation.md)（单人维护 + 本机 agent 的审批门控模型）

## 约定

1. **编号是历史 ID，不是阅读顺序**。`design/` 的 01–32、`history/` 的 27–39 沿用自上一条产品线，中间有缺号（业务篇目已随模板化删除）。新增规范用主题命名、不带编号；新的实施记录从 40 续号。
2. **代码是最终真源**。文档描述约定与边界；与代码冲突时以代码为准，并在同一次改动里回改文档。
3. **引用要可校验**。代码注释引用文档一律写仓库相对路径；`check:comments` 拦截失效的 `file:///` 引用与不存在的 `pnpm` 命令，`check:docs-scripts` 校验文档脚本表与 `package.json` 一致，`check:docs-contracts` 校验 IPC 计数/域清单、静态门禁数、`ErrorCode` 符号与代码路径引用。
4. **历史记录可能描述已剥离的能力**。`history/` 下的记录写于模板化之前，篇首「模板裁剪提示」与 [history/README](history/README.md) 的备注说明了哪些段落不再对应当前代码。
