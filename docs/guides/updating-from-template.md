# 从上游模板同步变更

派生项目已经用 `pnpm init:template` 改过品牌后，上游模板仍会继续修 bug、补门禁。本文说明如何安全同步，避免把品牌或业务改动覆盖掉。

## 1. 建立上游 remote

```bash
git remote add template <upstream-repo-url>
git fetch template main
```

如果派生项目已经改过 `.git` 历史（例如 squash 初始化提交），不要直接 `git merge template/main`。先在一个临时分支上做一次「空合并」建立共同祖先：

```bash
git switch -c chore/sync-template
git merge --allow-unrelated-histories template/main
```

## 2. 先看差异，不急着合并

```bash
git diff --stat HEAD...template/main
git diff HEAD...template/main -- scripts/ .github/ docs/
```

优先同步：
- `scripts/` 门禁与 `package.json` 脚本
- `.github/workflows/` CI/CD
- `docs/design/` 现行规范
- `src/main` / `packages/shared` 的通用底座修复

不要直接同步：
- `app.config.json`、`packages/shared/src/constants/brand.ts`（品牌真源）
- `electron-builder.yml` / `package.json` 里已改过的产品名、appId、仓库坐标
- `src/renderer/i18n/locales/*/common.json` 中已替换的产品文案
- `CHANGELOG.md` 的版本段与 `.release-please-manifest.json`
- `site/` 与 `.github/workflows/static.yml`（模板营销站；派生项目默认已在初始化时移除，若保留请独立维护）
- `resources/icons/`（派生项目应替换为自己的图标，不要同步模板图标）

## 3. 合并策略

1. 门禁脚本与配置优先整文件取上游，再按需合并本地扩展。
2. 品牌文件保留本地；合并后跑 `pnpm check:brand` 确认位点未漂移。
3. 业务页面（`src/renderer/routes/`、业务 `tables/`、业务 IPC 域）保留本地。
4. 冲突解决后先跑 `pnpm typecheck && pnpm lint && pnpm test:scripts`，再跑 `pnpm test:coverage`。
5. 最终按 [模板验收](template-acceptance.md) 在干净副本验证安装、启动与打包。

## 4. 内部包作用域

`@code-agent/*` 是模板内部 workspace 包名。`init:template` 默认按 `--owner` 小写推导新 scope，并同步重写包名、imports 与 `pnpm-lock.yaml`；可用 `--scope` 显式指定。同步上游时，把上游 diff 中的 `@code-agent/*` 替换为本项目 scope（或先以 `--scope code-agent` 初始化）；改完必须重新 `pnpm install --frozen-lockfile` 重链 workspace 包。

## 5. 同步后检查

```bash
pnpm install --frozen-lockfile
pnpm check:brand
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm test:integration
pnpm test:e2e
```

涉及打包或发版链路时，再按 [派生验收指南](template-acceptance.md) 验证安装包。
