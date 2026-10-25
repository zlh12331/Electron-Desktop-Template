# 安全政策（Security Policy）

## 支持的版本

本项目的安全修复只针对**最新发布版本**。请先升级到最新版再报告问题。

| 版本                                                                                          | 支持状态    |
| --------------------------------------------------------------------------------------------- | ----------- |
| 最新 release（见 [Releases](https://github.com/zlh12331/Electron-Desktop-Template/releases)） | ✅ 受支持   |
| 更早版本                                                                                      | ❌ 不再维护 |

## 报告安全漏洞

**请勿通过公开 Issue 报告安全漏洞** —— 公开渠道会立刻暴露问题，使所有用户面临风险。

请通过 GitHub 的**私密漏洞报告**渠道提交：

👉 **https://github.com/zlh12331/Electron-Desktop-Template/security/advisories/new**

也可以直接在仓库的 **Security** 标签页点击「Report a vulnerability」。该渠道**仅仓库维护者可见**，
你的报告内容与身份不会对外公开。

### 报告时请尽量包含

- 漏洞类型与影响（例如：远程代码执行 / 越权读写 / 凭据泄露 / SSRF）
- 受影响的版本
- **最小复现步骤**（越具体越好）
- 概念验证（PoC）代码或操作录屏（如适用）
- 你评估的严重程度，以及可能的修复方向（可选）

## 响应时间

本项目为**个人维护的开源项目**，响应尽力而为，无 SLA 承诺。通常期望：

| 阶段           | 目标时间                     |
| -------------- | ---------------------------- |
| 确认收到报告   | 7 天内                       |
| 初步评估与分类 | 14 天内                      |
| 修复与发布     | 视复杂度而定，会持续同步进展 |

若 14 天未收到回复，可在同一 advisory 内追问（不要改走公开渠道）。

## 披露流程

1. 你通过私密渠道提交报告
2. 维护者确认并在私密 advisory 内与你协作排查、修复
3. 修复随新版本发布后，公开发布安全公告（advisory）
4. 如你愿意，将在公告中署名致谢

我们遵循**协同披露（coordinated disclosure）**原则：在修复发布前不公开漏洞细节。
请给我们合理的时间窗口完成修复。

## 适用范围

本项目是桌面应用，攻击面主要涉及：
- **渲染层与 IPC**（XSS、sender 越权、CSP/导航绕过、preload 桥暴露面）
- **本地文件系统访问**（用户授权路径、符号链接/路径穿越）
- **凭据存储**（keychain / safeStorage；Linux 无密钥环时 basic_text 已被拒绝）
- **SQLite 主库与备份**（当前主库默认不做静态加密，敏感数据需 SQLCipher 或 OS 全盘加密）
- **自动更新链路**（更新源、差分元数据与产物完整性）
- **外链与深链**（自定义协议解析、系统浏览器打开策略）

以下**不属于**本政策范围的漏洞：
- 需要攻击者已具备本地管理员权限或物理接触设备的问题
- 依赖第三方服务（如 Sentry / OTLP 后端）自身的问题（请报告给对应厂商）
- 用户明确关闭安全机制（如自行放开沙箱）后产生的问题
- 仅存在于 vendored 第三方源码的依赖问题（请上报其上游项目）

## 安全设计说明

本项目在若干层面做了防御（详见 `docs/design/17-security-spec.md`）：
- **进程隔离**：`sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`；preload 只经 `contextBridge` 暴露白名单 API
- **渲染层边界**：主进程注入 CSP（含首帧内联脚本哈希）、导航/新窗白名单、系统权限请求全部拒绝；打包态菜单不提供 DevTools/Reload
- **IPC 边界**：定义表驱动的 zod 入参/响应校验 + sender URL/主 frame 校验；所有异常归一为稳定错误码
- **凭据**：API Key/代理凭据经 Electron `safeStorage`（Windows DPAPI / macOS Keychain / Linux libsecret）；Linux `basic_text` 被视为不可用并拒绝写入
- **文件访问**：用户经系统对话框选中的文件进入 realpath 规范化授权表；不自行拼接未授权路径
- **供应链**：SBOM（CycloneDX）随 release 归档 + asar 完整性校验 + gitleaks + Actions SHA pin + 发布年龄闸；每次发布附 `latest*.yml` 校验

## 致谢

感谢所有负责任地披露安全问题的研究者。
