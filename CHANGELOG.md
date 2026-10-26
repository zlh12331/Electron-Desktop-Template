# Changelog

## [0.3.0](https://github.com/zlh12331/Electron-Desktop-Template/compare/v0.2.1...v0.3.0) (2026-10-26)


### 新增

* 交付 Notes 参考切片与体积/内存加固 ([#39](https://github.com/zlh12331/Electron-Desktop-Template/issues/39)) ([283f43d](https://github.com/zlh12331/Electron-Desktop-Template/commit/283f43d59b878395bf14f9f5f48dbc2fba3146cd))

## 0.2.1 (2026-10-26)

<!-- changelog:polished -->

> 0.2.1 修复 0.2.0 的发布流水线与派生初始化：打包态 production smoke 恢复可用，`init:template --keep-site` 不再受上游版本号影响。

### 修复

- **发布流水线恢复**：0.2.0 六平台 production smoke 因关闭 inspect fuse 无法启动；恢复该 fuse（NodeOptions 仍关闭），并在配置回归测试中记录原因。
- **派生站点版本**：`init:template --keep-site` 改为匹配任意 semver 并统一写 `v0.0.0`，发版后不再因 package.json 版本变化而失败。
- **发布流程补记**：0.2.0 的详细变更保留在上一版本段；0.2.1 作为发布修复版本单独记录。

### 已知限制

- 三平台未签名包；自动更新「安装 → 更新 → 卸载」仍未真实演练。

## 0.2.0 (2026-10-26)

<!-- changelog:polished -->

> 0.2.0 聚焦真实桌面环境的可靠性：修复复制、托盘与打包态环境隔离，补齐备份恢复和深链边界，并把质量门禁扩展到脚本层。

### 新增

- **代理测试可指定目标**：设置页「测试连接」可填 http(s) 地址，默认仍用轻量 204 探针；默认端点不可达时可改用自己的地址。
- **派生初始化更完整**：`init:template` 支持内部 workspace scope 重命名；默认移除模板营销站与 Pages workflow，`--keep-site` 可保留并改写品牌、仓库与版本。

### 修复

- **真实窗口复制恢复**：About「复制诊断信息」与诊断卡片此前提示「剪贴板不可用」；现在只放行剪贴板写权限，复制可用，读取剪贴板仍拒绝。
- **托盘图标在打包版可见**：修正打包态图标路径，窗口最小化到托盘后不再出现「看不见的托盘」。
- **打包态不再信任 dev/test 环境变量**：`ELECTRON_RENDERER_URL`、关窗豁免、dev 更新和额外 env 文件只在未打包时生效，避免外部改写加载源或 IPC 来源。
- **备份恢复不再先删主库**：恢复时先暂存再原子替换，失败保留旧库；替换成功后清理旧 WAL/SHM。
- **深链协议大小写**：scheme 与 `open` host 不区分大小写，系统以大写形式唤起也能正确导航。
- **打包态关闭 DevTools 入口**：`devtools:open` 在打包版返回不可用，与生产菜单策略一致。
- **错误提示完整**：新增 `BRIDGE_UNAVAILABLE` 与双语文案，preload 缺失时不再回落英文伪错误码。
- **file:// 路由与设置启动**：修正 hash 路由 file 模式的 IPC sender 校验；设置弹层首次打开才挂载，减少启动加载。
- **快捷键与品牌元数据**：修复可配置快捷键的 key/code 与逗号分隔；补齐 protocols.name 与 Linux 包元数据；移除 Google Fonts 远程依赖并收紧 CSP。
- **凭据与 URL 边界**：Linux `basic_text` 后端不再保存凭据；渲染层 URL 与外链协议精确校验；postinstall 原生重编译失败会阻断安装。

### 性能

- 设置弹层懒加载，启动阶段不再加载设置大 chunk；未配置遥测时保持完整 no-op。

### 内部改进

- preload 独立覆盖率层 100%；`window.ts` 74/78 行、`settings.handler.ts` 60/60；关键模块按文件阈值卡关。
- `scripts` 纳入 file-size / functions / complexity 门禁；knip 回到生产入口；覆盖率 floors 上调 3–5pp。
- scaffold 失败回滚、品牌扫描覆盖 scripts 子目录、IPC 文档计数自动同步；备份/深链/差分更新补边界测试。
- 维持六平台 CI 矩阵、SBOM、原生架构断言与生产 smoke；依赖树按 Renovate 非 major 批次更新到 Electron 44.9.3、TypeScript 7.0.2、Vite 8.3.5、React 19.3。

### 已知限制

- 当前为**三平台未签名包**：Windows 可能触发 SmartScreen；macOS 未签名/未公证需手动绕过 Gatekeeper；自动更新「安装 → 更新 → 卸载」仍未做真实演练。
- 性能门槛覆盖 bundle 体积与启动耗时，暂无 FCP/LCP/INP 硬门槛；可观测性后端由接入方部署；SQLite 主库默认不加密。

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
