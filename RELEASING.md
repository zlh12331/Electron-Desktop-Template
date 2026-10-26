# 发布手册（RELEASING）

本仓库采用 **release-please + 单发布分支（main）** 的发布模型：版本号由 Conventional Commits
推导，CD 在六架构构建全部成功后才打 tag。模板默认只发稳定版，不包含 beta 流程。

## 一、责任分工

| 环节                | 负责                           | 说明                                                                                                                             |
| ------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 版本推导            | release-please                 | 读 Conventional Commits，更新 `.release-please-manifest.json` + `package.json`，生成 CHANGELOG                                   |
| Release PR          | release-please                 | 标题形如 `chore(main): release X.Y.Z`；**不要配 auto-merge**，合并即触发 CD                                                      |
| 打 tag / 建 Release | `release.yml`                  | 六架构构建 + 产物 smoke 全绿后才打 tag；失败不占版本号                                                                           |
| label 收尾          | `release.yml` release job      | 把 Release PR 从 `autorelease: pending` 改为 `autorelease: tagged`。这是 release-please 的进度游标，漏写会导致下一次发版被 abort |
| 对外发布            | `release.yml` publish job      | 校验安装包与四份 `latest*.yml` 齐全后，draft Release 转正式                                                                      |
| tag 保护            | ruleset `protect-release-tags` | `refs/tags/v*` 禁止删除与强推                                                                                                    |

## 二、版本基线（必读）

### 2.1 模板仓

- `package.json` 与 `.release-please-manifest.json` 当前均为 `0.2.1`；`v0.2.1` 已于
  2026-10-26 发布（26 个资产）。`v0.1.1` 于 2026-10-25 发布（26 个资产）。
- 版本推导现状：`0.1.1 → 0.2.0` 由 feat 驱动；0.2.0 的 CD 在 production smoke 失败、
  未产生 tag，随后通过手动发布 PR 产出 **0.2.1**（见 §4.1）。下次正常 `fix` → `0.2.2`，
  `feat` → `0.3.0`；仓库从未出现 `v0.1.0` / `v0.2.0` tag。
- `release-please-config.json` **顶层**保留了 `bootstrap-sha`（`06b08ca7`，模板合并提交）。
  它只用于首个 Release PR 的收集起点；首个 Release PR 合并后已失效，保留仅为历史锚点，
  不影响后续版本推导（如需清理可删除）。
- `bootstrap-sha` 必须是配置**顶层键**；写进 `packages["."]` 会被 release-please 静默忽略。
- 根提交没有父提交，无法被 `bootstrap-sha` 排除，因此锚点放在其后的 chore 提交上。

### 2.2 派生项目（`pnpm init:template`）

- 初始化会把 `package.json` 与 manifest **同时**重置为 `0.0.0`，并删除 `bootstrap-sha`。
  `0.0.0` 表示「尚未发布」，两个文件必须保持一致。
- 首个 `feat` 提交会得到首个版本 **`0.1.0`**。
- 初始化提交建议写成 `feat: 初始化项目`。若首个提交是 `chore`，release-please 不会开
  Release PR；之后首个 `fix` 会得到 `0.0.1`。要强制首版为 0.1.0，在任意提交正文加 footer：

  ```
  Release-As: 0.1.0
  ```

- 不要手工修改 `package.json` 或 manifest 的版本号，两者都由 release-please 维护。

## 三、常规发版流程

1. 功能/修复经 PR 合入 main（Conventional Commits；main 受 ruleset 保护，需 PR + 必需检查）。
2. release-please 在 push 后自动开/更新 Release PR。
3. 审阅版本号与 CHANGELOG。Release PR 分支（`release-please--`）上会自动执行：
   - `check:changelog-polish`：版本段不能全是机器原文
   - `check:release-pr-scope`：只允许 `CHANGELOG.md` / `.release-please-manifest.json` /
     `package.json`（package.json 仅允许版本行）
   - `check:release-anchor`：tag ↔ manifest ↔ Release PR label 三态自洽
4. 合并 Release PR（squash）。
5. `release.yml` 依次：gate 识别发布提交 → 六架构构建（Windows x64/ARM64、macOS arm64/x64、
   Linux x64/ARM64）+ 产物 smoke → 合成 win/mac 双架构更新元数据 → 打 tag + draft Release +
   label 收尾 → 校验资产转正式。
   - 产物 smoke 使用 Playwright `_electron.launch`，依赖 `--inspect`；`electron-builder.yml`
     必须保持 `enableNodeCliInspectArguments: true`。若未来要关闭该 fuse，需先提供不依赖
     Node inspector 的 smoke 方案，否则六平台 smoke 会全部无法启动（2026-10-26 0.2.0 实测）。
6. `latest*.yml` 随资产一起发布，供已安装客户端自动更新。

### 3.1 润色 CHANGELOG（必需）

squash 合并会让一个含几十个修复的 PR 在 CHANGELOG 里只剩一行 PR 标题。面向用户的更新说明
需要人工改写：

```bash
pnpm release:draft            # 展开版本区间内全部提交（含 squash 正文明细）生成底稿
# 按底稿改写 CHANGELOG.md 最新版本段：说清「用户得到什么」
pnpm check:changelog-polish   # 验证通过后再合并 Release PR
```

判定口径：该版本段**全部** bullet 都以提交链接结尾（`([abc1234](…/commit/abc1234))`）
= 机器原文 = 未润色；只要有一条不带链接即视为人工已介入。

推荐润色后在该版本段加一行 `<!-- changelog:polished -->`（GitHub 渲染不可见），
避免「逐条保留提交链接做溯源」时被误判。

`ci.yml` 在 Release PR 上自动执行该检查（获得合并阻塞力）；`release.yml` 打 tag 前再兜底一次。

## 四、失败与重放

任一环节失败（构建、smoke、merge、release、publish）都不会产生 tag，版本号不占号：
- 修代码后重新走 PR；或
- 手动重放 CD：Actions → Release → Run workflow。`confirm_version` 必须等于
  `package.json` 当前版本，否则 gate 拒绝。

注意：
- **不要移动已发布的 tag。** release job 显式使用 `target_commitish: release_sha`，重跑也钉在
  同一发布提交；改用 `github.sha`（main tip）会让 tag 漂移，release-please 下次会版本倒退。
- tag 受 `protect-release-tags` 保护，手动删除/强推会被拒。确需修复时临时调整 ruleset 或走
  bypass，修复后立即恢复。
- `publish` 失败时 Release 保持 draft；核对安装包与四份 `latest*.yml`
  （`latest` / `latest-mac` / `latest-linux` / `latest-linux-arm64`）是否齐全。

### 4.1 已合并 Release PR、CD 未出 tag（pending 卡死）

0.2.0 的实际恢复路径（2026-10-26）：
1. Release workflow 全平台 smoke 失败，未打 tag；Release PR #33 已合并但 label 仍为
   `autorelease: pending`。
2. 修复代码走普通 PR 合入 main（#36：恢复 inspect fuse + init-template 站点版本）。
3. release-please 因 pending 状态 **不会自动开下一个 Release PR**；手动建发布分支，只改
   `package.json` / `.release-please-manifest.json` / `CHANGELOG.md`，PR 标题必须是
   `chore(main): release X.Y.Z`（squash 后 release gate 依赖该 subject）。
4. `check:changelog-polish --version X.Y.Z`、`check:release-anchor --phase post-merge --version X.Y.Z`
   本地先跑通；合并后 CD 从 main HEAD 构建、tag 钉在该发布提交，产出新版本（0.2.1）。
5. 不要复用已失败版本号（0.2.0 无 tag 也不应重发）；新版本号更干净，release-please 也会在
   下一次 main 变更时恢复常态。

若只是**构建/网络抖动**且发布提交本身可复用，可走 workflow_dispatch 的受控重放；但只要
修复引入了新代码，就必须用新版本，否则 tag 与产物不一致。

### 4.2 常见故障

| 现象                                                                                           | 原因与处置                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| push 后不再开 Release PR，日志 `There are untagged, merged release PRs outstanding - aborting` | 存在已合并但仍带 `autorelease: pending` 的 Release PR（判定只读 label，不检查 tag）。若 CD 已失败未出包，按 §4.1 修复并用新版本；不要只改 label 强行重开，否则 tag 与产物可能不一致 |
| Release PR 迟迟等不到检查                                                                      | 缺少 `RELEASE_PLEASE_TOKEN`。`GITHUB_TOKEN` 产生的事件不触发其他 workflow，必需检查永远等不到。配置细粒度 PAT（contents + pull-requests 写权限）                                    |
| 手动 dispatch 报「未能在最近 300 个提交中找到发布提交」                                        | 该版本的 Release PR 尚未合并，或版本号填错。确认 `chore(main): release X.Y.Z` 已在 main 上                                                                                          |
| 更新已存在的 Release 报 403                                                                    | 对已存在 release 做 update 会被拒；正常路径是 create。重放已存在 tag 时用 `gh release edit` 手动处理                                                                                |

## 五、签名与分发

**当前发布口径：三平台未签名包。** 未检测到 `CSC_LINK` 时 `CSC_IDENTITY_AUTO_DISCOVERY=false`，
产物为未签名包，适合自用、内测与模板演示，**不适合面向普通用户的正式分发**。

未签名安装包的用户侧限制：
- **Windows**：可能触发 SmartScreen，选择「更多信息 → 仍要运行」。
- **macOS**：未签名/未公证，首次打开需在「系统设置 → 隐私与安全性」允许，或手动清隔离属性：

  ```bash
  xattr -dr com.apple.quarantine "/Applications/<应用名>.app"
  ```

- **自动更新**：v0.2.1 已完成一次用户实测更新（2026-10-26，未签名包）；macOS 未签名包的
  Squirrel.Mac 更新仍未验证，建议手动下载安装。Windows/Linux 可继续实测，但缺少代码签名
  信任链，正式分发前仍需签名/公证。

`release.yml` 会在检测到 Windows 或 macOS 签名凭据缺失时，自动把上述提示追加到 GitHub Release 正文，避免用户下载后才遇到拦截。

后续要转为正式分发，配置：
- Windows / macOS 代码签名：`CSC_LINK` + `CSC_KEY_PASSWORD`
- macOS 公证：`APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`
  （或 `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`）

### 5.1 可观测性（可选）

发布构建会自动尝试上传 Sentry source map；以下 Secrets 任一缺失时脚本打印跳过原因并继续构建：
- `SENTRY_DSN`：构建期注入的默认 DSN（运行时环境变量可覆盖；不配则错误上报 no-op）
- `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`：source map 上传凭据

原生调试符号默认不上传；需要原生崩溃完整符号化时设置仓库变量 `SENTRY_UPLOAD_DEBUG_FILES=1`
（会显著增加 CI 时间与 Sentry 存储）。CD 在构建前执行 `pnpm observability:doctor --release --offline`：
上传凭据半配置会直接 fail，全缺/全配都放行。详见 [可观测性运行手册](docs/guides/observability-runbook.md)。

未配置时 CD 不会因此失败；`release.yml` 会根据签名凭据是否存在自动追加「未签名构建提示」。

## 六、预发布（可选，模板默认关闭）

当前配置是稳定版策略，没有 `versioning: prerelease` / `prerelease-type`。需要 beta 时自行在
`packages["."]` 增加 prerelease 配置，并同步调整本文档与相关测试；模板不提供现成的 beta 流程。

## 七、热修复（需要时再启用）

当前只有 main 一条发布分支。若已发布版本需要单独修复、而 main 已累积新功能：从对应 tag 切
`release/x.y` 维护分支，cherry-pick 修复，并按该分支独立的 manifest 与 workflow 配置发版。
尚无实际需求，不提前落地。
