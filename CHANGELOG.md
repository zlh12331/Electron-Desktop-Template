# Changelog

<!-- template:keep-start -->
本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
版本段由 release-please 依据 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 生成；
发版前在 Release PR 中润色为面向用户的文案（见 [RELEASING.md](RELEASING.md) §2.1，`pnpm check:changelog-polish` 卡关）。

## 怎么写

- **面向用户，不面向提交**：读者只关心「我得到了什么、修好了什么」。用户感知不到的改动放进「内部改进」或略去。
- **分组顺序固定**：新增 → 修复 → 性能 → 内部改进 → 破坏性变更；没有内容的分组整段省略，不留空标题。
- **每条写清三件事**：改了什么、之前什么表现、现在什么表现。有实测数字才写数字。
- 好：`- **修复升级后窗口不恢复**：上次退出时最大化，更新后启动却是普通大小——现在按退出前状态恢复`
- 差：`- fix(window): 持久化 maximize 状态并在 ready-to-show 恢复`（用户看不懂）

## 版本段模板

复制下面的结构到新版本段（`##` 标题、版本号与日期由 release-please 生成，不要手改）：

```markdown
## [0.2.0](https://github.com/zlh12331/Electron-Desktop-Template/compare/v0.1.0...v0.2.0) (2026-10-23)


### 新增

* 初始化桌面应用模板 ([2516134](https://github.com/zlh12331/Electron-Desktop-Template/commit/2516134d0e7913299b773eb1b311de884b8b1303))

## [<version>](https://github.com/<owner>/<repo>/compare/v<prev>...v<version>) (<date>)

> 一段话说清本版主线：解决了什么痛点、用户最该注意哪一处变化。两到三句，不写内部术语。

### 新增

- **能力名**：它让用户能做什么；与之前相比省掉了哪一步

### 修复

- **问题现象**：之前会怎样（可观察的表现）——现在的行为

### 性能

- **场景**：在什么条件下更快/更省（有实测数字才写；没有就整段省略）

### 内部改进

- 工程侧改动（CI / 门禁 / 重构），一句话一条，不展开

### 破坏性变更

- 变更内容；迁移方式（是否自动迁移、需手工改什么）
```
<!-- template:keep-end -->

暂无版本记录。首次发版后，release-please 会在此处生成第一个版本段。
