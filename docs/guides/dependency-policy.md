# 依赖策略（Node 26 LTS）

> 决策日期：2026-10-24。**本模板只支持 Node 26 LTS**；Node 24 已进入维护期，不纳入支持矩阵，也不为它增加双版本 CI。
>
> 本文回答：哪些版本组合受支持、谁能自动升级、安全补丁怎么走、override 什么时候必须删。

## 1. 支持矩阵

| 组件                     | 口径                                                       | 真源                             |
| ------------------------ | ---------------------------------------------------------- | -------------------------------- |
| Node.js                  | **26 LTS**（当前 `.nvmrc` 26.8.1；`engines.node >=26`）    | `package.json` / `.nvmrc` / CI   |
| pnpm                     | 12.x（`packageManager` 固定 12.10.1；`engines.pnpm >=12`） | `package.json`                   |
| Electron                 | 44.x（当前 44.9.1；major 人工评审）                        | `package.json` / `renovate.json` |
| TypeScript               | 7.x                                                        | `package.json`                   |
| Vite / electron-vite     | Vite 8.x / electron-vite 6.0.0 稳定版                      | `package.json`                   |
| React / Router / i18next | React 19.x / React Router 8.x / i18next 26.x               | `package.json`                   |

CI 的六平台矩阵统一使用 Node 26。Node 27+ 尚未验证；`engines` 不设上限是为了避免新 Node 发布后用户被 `package.json` 直接挡住，但不代表已验证。升级 Node 主版本必须同时更新 CI 矩阵、`.nvmrc`、本文与 `engines`。

## 2. 更新节奏

- **常规更新**：Renovate 每周末执行；非 major 分组（Electron 除外）；`prConcurrentLimit: 3`。
- **发布年龄闸**：`minimumReleaseAge: 1 day`（`pnpm-workspace.yaml` 的 1440 分钟），防依赖投毒。
- **安全更新**：Renovate `vulnerabilityAlerts` 已启用并打 `security` 标签；高危/严重漏洞 24 小时内处理。
- **锁文件**：CI 与发布必须 `pnpm install --frozen-lockfile`；不允许手动改 `pnpm-lock.yaml` 绕过审阅。

## 3. 安全补丁

1. 先跑 `pnpm audit:registry`，确认 advisory 与受影响路径。
2. 优先升级到同主版本补丁；没有补丁时才用 `overrides` 或 `.nsprc` 白名单，并在 PR 写明理由、上游修复条件与移除日期。
3. 安全补丁版本若发布不足 24 小时，可临时使用：

   ```bash
   pnpm install --config.minimumReleaseAge=0
   ```

   该绕过仅用于安全修复；必须在 PR 描述中附 advisory 链接与审计结果，不能成为日常安装方式。
4. 补丁完成后重跑 `pnpm audit:registry`，目标为 **0 high / 0 critical**；moderate 也必须清零或按白名单登记。

## 4. 主版本升级

TypeScript、Vite、electron-vite、React Router、i18next、Electron 的 major 一律人工评审，Renovate 通过 Dependency Dashboard 等待确认，不自动进入合并队列。

每次只升一个 major，并完成：

```bash
pnpm verify:local
pnpm test:coverage
pnpm test:e2e:electron
pnpm build:win:x64
pnpm check:native-arch
pnpm test:smoke
```

Electron major 在 `renovate.json` 中直接禁用，由维护者单独排期；Electron patch/minor 独立成组，避免和其他依赖更新混在一起掩盖原生模块问题。

## 5. beta / RC 禁令

主依赖（dependencies / devDependencies）不得使用 beta、rc、canary 等预发布版本。确需使用时必须：
- 单独 ADR 或设计记录说明原因；
- 明确退出计划与目标稳定版本；
- 不进入模板默认分支的 lockfile，除非该记录已合并。

electron-vite 曾使用 beta.1，2026-10-24 已收敛到 6.0.0 稳定版；后续不得回退到 beta 作为默认构建链。

## 6. override 生命周期

`pnpm-workspace.yaml` 中每条 override 必须包含：
- 对应 advisory / CVE；
- 加入日期；
- 上游修复后的移除条件。

每季度审计一次；上游已修复的 override 必须删除，不能让临时安全钉变成永久版本锁。当前 override 集中在 undici、fast-uri、body-parser、brace-expansion、js-yaml、postcss、tar 等传递链，新增时必须沿用同一格式。

## 7. 原生模块、preload 与渲染层预算

- **Electron patch/minor**：升级后必须重编 better-sqlite3 等原生模块，并跑 `pnpm check:native-arch` + `pnpm test:smoke`。
- **preload**：保持 CJS、零第三方运行时依赖；需要共享类型时走 `@code-agent/shared/preload` 等零依赖子路径。
- **renderer**：新增依赖前评估 bundle 增量；单依赖超过 150KB（gzip）需在 PR 论证，并保持 `pnpm check:bundle` 通过。
- **Node 内置能力优先**：能用 `node:fs` / `node:crypto` / `fetch` 解决的不新增全家桶。

## 8. 相关文档

- [AGENTS.md](../../AGENTS.md)：扩展点与质量门禁
- [pnpm-workspace.yaml](../../pnpm-workspace.yaml)：发布年龄闸与 override 真源
- [renovate.json](../../renovate.json)：自动升级分组与 major 审批
- [17 安全规范](../design/17-security-spec.md)：供应链与凭据边界
- [12 性能规范](../design/12-performance-spec.md)：bundle 预算
- [ci-cd.md](ci-cd.md)：Node 26 六平台矩阵与发布流水线
