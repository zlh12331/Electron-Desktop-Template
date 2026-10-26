# Changelog

## [0.2.0](https://github.com/zlh12331/Electron-Desktop-Template/compare/v0.1.1...v0.2.0) (2026-10-26)


### 新增

* **main:** 生产版改用不含 View/DevTools 的最小应用菜单 ([eb1a35e](https://github.com/zlh12331/Electron-Desktop-Template/commit/eb1a35ebe6aab1eaa5f4e4c9abe5abda0bf812b5))
* **scripts:** init:template 支持内部 workspace scope 重命名 ([136eec0](https://github.com/zlh12331/Electron-Desktop-Template/commit/136eec0bcef6d0f29d1161bcff57f727efe8d82b))


### 修复

* **ipc:** 允许 hash 路由的 file 入口通过 sender 校验 ([0b302cc](https://github.com/zlh12331/Electron-Desktop-Template/commit/0b302cc4a720945c3f2dfbe0b43c0b4e7666bb67))
* **quality:** 修复剪贴板/fuses 并收紧质量门禁 ([#35](https://github.com/zlh12331/Electron-Desktop-Template/issues/35)) ([ddc48fd](https://github.com/zlh12331/Electron-Desktop-Template/commit/ddc48fd63acc5ab2f942726c1f2c4d41a15b4888))
* **renderer:** mock API 增加编译期与运行时契约 ([72c6e51](https://github.com/zlh12331/Electron-Desktop-Template/commit/72c6e5167ff7bcf4f5812de9391e9620473b4a45))
* **renderer:** 修复可配置快捷键的 key/code 与逗号分隔问题 ([09cd848](https://github.com/zlh12331/Electron-Desktop-Template/commit/09cd848fe7d45980260016b970ab6df03dacf918))
* **renderer:** 弹层改为首次打开才挂载，避免启动加载设置大 chunk ([6de278b](https://github.com/zlh12331/Electron-Desktop-Template/commit/6de278be730a4e7b0c1acdcdbc541546faf34648))
* **scripts:** postinstall 原生重编译失败时阻断安装 ([5f32f37](https://github.com/zlh12331/Electron-Desktop-Template/commit/5f32f37e8b7350abc86f67359be2a26796118194))
* **scripts:** 修复 check:i18n 的 keyed 提取正则并补错误码双语测试 ([d03e8ce](https://github.com/zlh12331/Electron-Desktop-Template/commit/d03e8ce99dedddb2e4daa621d5e0f6ce90401ff5))
* **scripts:** 派生验收副本保留官方 registry 配置 ([dd48f30](https://github.com/zlh12331/Electron-Desktop-Template/commit/dd48f308d1c475e59b3c1925ba5f32026f3d600d))
* **scripts:** 补齐 protocols.name 与 Linux 包元数据的品牌同步 ([ca94ab9](https://github.com/zlh12331/Electron-Desktop-Template/commit/ca94ab93c05d828a4478b00dd7759bd4bf59f1dc))
* **security:** 移除 Google Fonts 远程依赖并收紧 CSP ([69297b7](https://github.com/zlh12331/Electron-Desktop-Template/commit/69297b7f58f09935058e146ae552245d9b5cb8eb))
* **security:** 精确校验渲染层 URL 与外部链接协议 ([7ed25a0](https://github.com/zlh12331/Electron-Desktop-Template/commit/7ed25a0eaf92d6375948448e1ab04e57cdde6331))
* **security:** 识别 Linux safeStorage basic_text 并禁用凭据存储 ([d752c0f](https://github.com/zlh12331/Electron-Desktop-Template/commit/d752c0f88a723d4005b6b079c882b62b20b013ea))

## 0.1.1 (2026-10-25)

<!-- changelog:polished -->

> 首个公开版本：模板从可运行骨架推进到可验证、可维护、可审计的工程基线，并补齐 IPC 契约、凭据安全、冷启动深链、可观测性与质量门禁。

### 新增

- **类型安全 IPC 契约**：通道、schema、preload API 与 handler 由同一张定义表推导，新增方法不再手写多处；来源校验、入参/响应校验统一在边界完成。
- **安全的设置与凭据**：设置持久化到 SQLite；代理 URL 中的用户名/密码改存系统密钥库，设置导出与诊断包自动脱敏，设置页可清除已保存凭据。
- **冷启动深链**：自定义协议唤起时先暂存，渲染层挂载后取回，避免应用启动早期丢事件。
- **可观测性与发布**：遥测默认关闭；Sentry/OpenTelemetry 未配置时完整 no-op；发布流水线包含 SBOM、原生架构断言与生产 smoke。

### 修复

- **数据库损坏自愈**：启动依次尝试 quick_check、健康备份恢复、归档重建；备份链串行化，手动备份不再与启动备份并发写。
- **渲染层测试稳定性**：测试环境隔离 electron-log 惰性导入，Windows ARM runner 回退 forks 池，消除 worker teardown 假红。
- **遥测初始化**：OpenTelemetry SDK 统一到 3.0，修复 exporter 与 SDK 主版本错配时的初始化失败；单个信号异常不会影响其余信号与主流程。
- **发布/CI 边界**：修复跨平台路径断言、CodeQL 报告的端点推导 ReDoS 风险，以及文档契约对构建期生成物的误判。

### 性能

- **渲染层单测**：65 个 jsdom 文件从约 97 秒降到约 32 秒（threads 池，非 Windows ARM）。
- **生产启动**：打包产物冷启动到可交互约 2.2 秒；新增启动耗时趋势记录，环比异常会告警。

### 内部改进

- 覆盖率显式纳入全部源码，新增覆盖率范围、关键模块阈值与 settings 子集硬门槛；shared 覆盖率下限收紧。
- 依赖树更新到当前最新：Electron 44.9.3、Biome 2.6、OpenTelemetry SDK 3.0、undici 8、js-yaml 5、markdown-it 15 等；`pnpm audit` 为 0 high / 0 critical。
- Node 26.12.1 + pnpm 12.15.0 为唯一支持组合；major 人工评审、beta 禁令与 override 生命周期写入依赖策略。
- 新增 Windows 视觉基线、生产启动趋势和上游模板同步指南；Renovate 配置迁移到 `matchPackageNames`。

### 已知限制

- 当前为**三平台未签名包**：Windows 可能触发 SmartScreen；macOS 未签名/未公证需手动绕过 Gatekeeper；macOS 自动更新未验证。
- 性能门槛目前覆盖 bundle 体积与启动耗时，没有 FCP/LCP/INP 硬门槛；可观测性后端由接入方部署。

<!-- template:keep-start -->
本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
版本段由 release-please 依据 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 生成；
发版前在 Release PR 中润色为面向用户的文案（见 [RELEASING.md](RELEASING.md) §2.1，`pnpm check:changelog-polish` 卡关）。

### 怎么写

- **面向用户，不面向提交**：读者只关心「我得到了什么、修好了什么」。用户感知不到的改动放进「内部改进」或略去。
- **分组顺序固定**：新增 → 修复 → 性能 → 内部改进 → 破坏性变更；没有内容的分组整段省略，不留空标题。
- **每条写清三件事**：改了什么、之前什么表现、现在什么表现。有实测数字才写数字。
- 好：`- **修复升级后窗口不恢复**：上次退出时最大化，更新后启动却是普通大小——现在按退出前状态恢复`
- 差：`- fix(window): 持久化 maximize 状态并在 ready-to-show 恢复`（用户看不懂）

### 版本段模板

版本号标题由 release-please 生成，形如 `## [x.y.z](compare-url) (date)`，不要手改。正文结构：

```markdown
> 一段话说清本版主线：解决了什么痛点、用户最该注意哪一处变化。两到三句，不写内部术语。

**新增**
- **能力名**：它让用户能做什么；与之前相比省掉了哪一步

**修复**
- **问题现象**：之前会怎样（可观察的表现）——现在的行为

**性能**
- **场景**：在什么条件下更快/更省（有实测数字才写；没有就整段省略）

**内部改进**
- 工程侧改动（CI / 门禁 / 重构），一句话一条，不展开

**破坏性变更**
- 变更内容；迁移方式（是否自动迁移、需手工改什么）
```

<!-- template:keep-end -->
