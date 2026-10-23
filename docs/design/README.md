# 设计规范（design）

> 本目录收录**长期有效**的「怎么建」规范：架构边界、契约流程、渲染层约定与质量门槛。
> 操作指南见 [../guides/](../guides/README.md)，一次性实施记录见 [../history/](../history/README.md)。
>
> 代码现状以仓库为准；本目录描述**约定与边界**，不是代码地图。目录地图见 [03](03-directory-structure.md)。

## 一、架构与约束

| # | 文档 | 内容 | 挂钩门禁 |
|---|---|---|---|
| 01 | [架构设计](01-architecture.md) | 进程模型、组合根、IPC 体系、数据层、状态分层、安全基线 | — |
| 02 | [技术栈](02-tech-stack.md) | 选型与边界（版本以 package.json 为准） | — |
| 03 | [目录结构](03-directory-structure.md) | 仓库目录地图与扩展点 | — |
| — | [模板约束机器](template-architecture.md) | 单一真源 + 机器门禁：IPC 定义表 / 错误模型 / 数据层 / 棘轮 / CI 拓扑 | — |

## 二、契约、数据与状态

| # | 文档 | 内容 | 挂钩门禁 |
|---|---|---|---|
| 19 | [IPC 集成规范](19-ipc-spec.md) | 通道命名、新增方法三步流程、事件与错误契约 | typecheck（handler/响应契约缺失编译期或启动期报错） |
| 18 | [数据层规范](18-data-layer-spec.md) | SQLite + Drizzle：schema 单一真源、迁移、事务边界 | check:schema-drift |
| 21 | [状态管理规范](21-state-management-spec.md) | 四层架构与判定标准 | — |
| — | [数据所有权](data-ownership.md) | 每类数据的真源、缓存与失效责任 | — |

## 三、渲染层与设计体系

| # | 文档 | 内容 | 挂钩门禁 |
|---|---|---|---|
| — | [渲染层规范](renderer-spec.md) | 入口 / 路由 / 布局 / hooks / stores / lib | check:ui-consistency |
| 09 | [前端实现指南](09-ux-interaction-spec.md) | 渲染层架构、布局、组件、数据流与浏览器模式 | check:ui-consistency |
| 10 | [组件设计规范](10-component-design-spec.md) | 组件原则、样式铁律、状态设计、文档模板 | check:tokens / check:css-vars / check:animations / check:comments |
| 08 | [UX 设计规范](08-ux-guidelines.md) | 模板信息架构、视觉规范、反馈与验收清单 | check:tokens |
| 11 | [可访问性](11-a11y-spec.md) | 对比度、键盘、焦点与 ARIA 验收 | — |
| 13 | [表单验证](13-form-validation-spec.md) | zod 单一真源 + 受控表单模式 | — |
| 14 | [i18n 规范](14-i18n-spec.md) | key 命名、双语同步与新增流程 | check:i18n |
| 12 | [性能规范](12-performance-spec.md) | Bundle 门槛、渲染纪律、长列表接入建议 | check:bundle / check:compiler / check:devtools |

## 四、安全、错误与可观测

| # | 文档 | 内容 | 挂钩门禁 |
|---|---|---|---|
| 17 | [安全规范](17-security-spec.md) | Electron 生产级基线：进程隔离 / CSP / 凭据 / 依赖 | check:csp-hash / check:secrets-git |
| 16 | [错误与日志](16-error-logging-spec.md) | AppError、traceId、ErrorBoundary 分层与本地优先上报 | — |
| 23 | [可观测性](23-otel-spec.md) | L4：Sentry 错误/崩溃、OTel trace/metrics/logs、Web Vitals、遥测级别与脱敏边界 | — |

## 五、流程

| # | 文档 | 内容 |
|---|---|---|
| 32 | [新功能三阶段流程](32-feature-workflow-spec.md) | 需求讨论 → 设计 → 实施；分级裁剪与两个强制检查点 |

## 六、维护约定

1. **同 PR 同步**：代码改动涉及某篇规范时，同一 PR 内更新文档；源码注释中的文档引用一并核对。
2. **门禁兜底**：`check:comments`（注释与代码漂移、失效文件引用、不存在的 `pnpm` 命令）、`check:docs-scripts`（文档脚本表 ↔ package.json）、`tokens:check`（令牌生成物一致性）。
3. **编号规则**：既有编号保留（历史 ID，有缺号）；新增规范用主题命名、不带编号，如 `release-versioning-spec.md`。
4. **新功能落位**：按 32 号流程产出 `docs/history/NN-<slug>-spec.md`，在 [history/README](../history/README.md) 登记。彻底过时的一次性交付直接删除（git 历史可追回），不设归档目录。
