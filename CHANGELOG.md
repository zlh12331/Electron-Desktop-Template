# Changelog

## [0.5.0](https://github.com/zlh12331/Electron-Desktop-Template/compare/v0.4.1...v0.5.0) (2026-10-28)

<!-- changelog:polished -->

> 0.5.0 重做网络代理：支持 HTTP/HTTPS/SOCKS5 与结构化配置；固定代理保留 undici 认证，系统/直连走 Chromium 系统代理与 PAC；设置页补齐协议、认证、绕过、系统导入和可归因的连通性测试。

### 新增

- **SOCKS5 与结构化代理配置**：设置值改为 `{mode, protocol, host, port, bypass}`，协议支持 HTTP/HTTPS/SOCKS5；代理认证拆到 keychain，落库与导出不含凭据。
- **双栈请求分流**：固定代理走 undici `ProxyAgent`（HTTP/HTTPS 认证、SOCKS5 无认证），`system`/`direct` 走 Chromium `session.fetch`，跟随系统代理/PAC；固定代理保留 undici 以避开主进程 `net.fetch` 的代理认证限制。
- **设置页重做**：协议/主机/端口、独立认证与密码显示、多行绕过、当前系统代理展示/刷新、从系统代理导入、500ms 防抖保存与行内校验。
- **可归因的连通性测试**：支持草稿配置即测、1.5 秒 TCP 预探和耗时返回，区分代理不可达、认证失败、超时与目标不可达；新增 `proxy:detectSystem` 与 `proxy:clearAuth`。

### 修复

- **代理凭据边界**：旧 URL 内嵌凭据在启动时迁移到 keychain；换代理主机自动丢弃旧凭据；日志只记录协议/主机/端口与是否存在认证。
- **绕过规则一致**：Node 侧补齐域名后缀、通配与 CIDR；`NO_PROXY` 包含用户绕过列表；`system` 恢复启动时继承的环境变量，`direct` 清空。
- **测试连接口径**：浏览器模式 mock 与主进程统一为 `not-applicable` 返回 `ok:false`，避免误显示成功。

### 内部改进

- 设置 schema、IPC 契约、主进程解析/应用/凭据/测试、设置页与测试同步更新；补齐代理相关单测与关键模块覆盖率。
- 更新代理设计、安全、数据、校验、错误日志、技术栈与 IPC 契约文档；Knowledge Center Wiki 同步 6 个页面。

### 已知限制

- SOCKS5 认证暂不支持（Chromium 限制）；需要认证的 SOCKS5 可使用 HTTP/HTTPS 代理或本地 HTTP 桥接。
- 自动更新仍以 GitHub Releases 为唯一渠道。

## [0.4.1](https://github.com/zlh12331/Electron-Desktop-Template/compare/v0.4.0...v0.4.1) (2026-10-27)

<!-- changelog:polished -->

> 0.4.1 修复更新安装前多出的一层确认弹窗：点击「重启并安装」后直接打开安装向导，不再出现误导性的任务中断提示。

### 修复

- **更新安装流程**：移除「重启并安装」前的确认弹窗。模板没有会被中断的运行中任务，原「有正在进行的任务」文案与红色危险样式一并删除；点击后直接退出并打开安装向导，安装完成点「完成」自动启动新版本。

## [0.4.0](https://github.com/zlh12331/Electron-Desktop-Template/compare/v0.3.0...v0.4.0) (2026-10-27)

<!-- changelog:polished -->

> 0.4.0 重排设置信息架构并默认跟随系统，同时升级 Electron 45；凭据存储迁移到异步 API，修复了隐藏驻留后二次启动无法唤回窗口的问题。

### 新增

- **设置页 8 个一级分区**：通用 / 外观 / 通知 / 数据 / 快捷键 / 网络代理 / Beta / 关于，导航更扁平，原「凭据」并入「数据」。
- **更新与实验分区归位**：自动检查、下载、安装和预发布开关统一放回「关于」；Beta 只保留实验功能入口，不再混放更新控件。
- **主侧栏两段式布局**：笔记固定在顶部，设置固定在左下角；独立关于页及相关路由、命令面板入口移除。
- **默认跟随系统**：语言与主题改为下拉框，新安装默认跟随 OS；主题选择仍支持浅色 / 深色。
- **Electron 45**：运行时升级到 Chromium 156 / Node 24.22，原生模块已按新 ABI 重编。

### 修复

- **隐藏驻留唤回**：Electron 45 下 `getAllWindows()` 可能先返回 DevTools；改为显式跟踪主窗口，二次启动可稳定唤回隐藏窗口。
- **删除 Notes 后的残留引用**：修复模板移除示例后侧栏仍引用 `NotebookPen` / `ROUTES` 的类型错误。
- **凭据存储**：`safeStorage` 迁移到异步 `encryptStringAsync` / `decryptStringAsync`，并处理密钥轮换 `shouldReEncrypt`；Electron 46 移除同步 API 前完成迁移。

### 内部改进

- 非主版本依赖批量更新（Biome、Vite、Vitest、Playwright、React Router、Radix、i18next 等），`pnpm audit` 为 0 high / 0 critical。
- 同步技术栈、依赖策略、安全规范、README 与站点版本说明。
- 更新 8 个设置分区的 a11y、视觉基线、Electron E2E 与派生模板验收。

### 移除

- 移除「启动时最小化到托盘」设置：手动启动始终显示窗口；开机自启的 `--hidden` 静默驻留保持不变。

### 已知限制

- Windows / macOS / Linux 仍为未签名包，正式分发需配置平台签名凭据。
- 自动更新仍以 GitHub Releases 为唯一渠道。

## [0.3.0](https://github.com/zlh12331/Electron-Desktop-Template/compare/v0.2.1...v0.3.0) (2026-10-26)

<!-- changelog:polished -->

> 0.3.0 增加一条可整体删除的完整业务样本，并收紧安装包体积与全屏浮层的运行内存；底座契约、派生验收与文档同步对齐。

### 新增

- **Local Notes 参考切片**：新增从 zod 契约、SQLite 迁移、IPC handler、Query 缓存/失效到列表/编辑器/搜索/导入导出/深链的完整示例，并配有独立设计文档与浏览器/Electron 测试。
- **派生初始化默认移除示例**：`init:template` 默认删除 Notes 代码与迁移，`--keep-example` 可保留；已有项目可用 `pnpm remove:notes-example`，默认保留 `notes` 表，`--drop-table` 才生成清表迁移。
- **状态细节完善**：笔记“搜索无结果”与“空库”分开提示；设置、命令面板、快捷键帮助的懒加载浮层有统一加载占位。

### 修复

- **派生验收修复**：初始化后自动用 Biome 重排；清理 Sidebar/mock-api 中仅示例使用的 import；示例测试与营销站断言在派生副本中正确跳过；失效域文档与实际生产者对齐。
- **数据所有权文档**：补记 `notes` 表、写入方与失效责任，并明确“词表声明不等于已接线”。

### 性能

- **安装包体积**：Windows x64 NSIS 从 134.89 MB 降至 112.19 MB（-16.8%）；裁剪 Electron 语言包、better-sqlite3 全平台预编译与 Sentry 调试符号，`app.asar` 减少约 41%。
- **运行内存**：命令面板移除全屏 `backdrop-filter` 模糊层；设置页全屏 Sheet 移除不可见遮罩和阴影；本机打包产物设置页 GPU private 约 316 → 270 MB，关闭后仍保持下降。

### 内部改进

- IPC 规范同步至 14 域 / 55 通道；派生验收覆盖示例移除、迁移与文档计数同步。
- 模板定位明确为一次性起点：不提供上游同步机制，派生项目自行维护。

### 已知限制

- 三平台仍为未签名包；自动更新「安装 → 更新 → 卸载」尚未完成真实演练。
- 本机 Windows 存在 `app.asar` 文件锁，六平台打包与 production smoke 由 CD 验证。

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
