# 17 · 安全规范（Electron 生产级基线）

> 对齐 Electron 官方安全清单与 OWASP 桌面应用实践，按模板当前实现（sandbox / CSP / safeStorage / zod / fuses）制定。
> 最后同步：2026-10-25（补充数据库静态加密边界与 URL 精确白名单）

---
> 🔒 工程化强制：`check:csp-hash`（CSP 内联哈希）+ `check:secrets-git`（pre-push / CI）+ `check:secrets`（全仓自查）+ `check:devtools`（产物不含 devtools）

## 一、进程隔离（不可回退）

| 项 | 现状 | 约束 |
|---|---|---|
| `sandbox: true` | ✅ `window.ts` | 不可回退 |
| `contextIsolation: true` / `nodeIntegration: false` | ✅ | 渲染层只能经 `contextBridge` 暴露的 `window.api` |
| preload 零第三方运行时 | ✅ CJS + 纯字符串 `IPC_META` | 禁止引入 zod 等 ESM 包（沙箱下静默失败，`window.api` 变 undefined） |

## 二、CSP 与导航

- **CSP**：`src/main/security/csp.ts` 对 `defaultSession` 统一注入；产线 `script-src` 只认自身、wasm 与**一个内联脚本哈希**（`check:csp-hash` 卡关——改 CSP 或 `index.html` 内联脚本必须同步重算）。`init:template` 改写 `storagePrefix` 时会同步重算该哈希，回归见 `scripts/init-template.test.ts`。
- **开发期**放宽项（Vite HMR / React DevTools）只在 `!app.isPackaged` 生效，禁止进产线策略。
- **导航**：`will-navigate` 拦截站外跳转；`setWindowOpenHandler` 统一改为系统浏览器打开；外链只走 `app:openExternal`。
- **权限**：`setPermissionRequestHandler` 与 `setPermissionCheckHandler` 双收口，渲染层系统权限请求/查询一律拒绝（当前无任何授权项）。
- **IPC 来源**：仅接受主 frame（`senderFrame === sender.mainFrame`）且 URL 白名单；`file:` 入口要求 path/host 完全匹配、拒绝 query（防同后缀路径伪造），**允许 hash**——生产构建使用 hash router，hash 不改变实际加载的资源，拒绝它会让 About 等路由的所有 IPC 被 sender 校验误杀。

## 三、密钥与凭据

1. **存储**：Electron `safeStorage` 加密落 `userData/keychain.dat`（Windows DPAPI / macOS Keychain / Linux libsecret）；写入用 `0o600` 临时文件原子替换，Windows 额外用 `icacls` 断继承、仅授予当前用户（纵深防御，失败只告警）。Linux 没有可用密钥环时 Electron 会回退到 `basic_text`（硬编码密钥，官方明确称为 unprotected）——模板把该后端视为不可用，拒绝写入并把 `secrets:isAvailable` 的 `reason` 报为 `insecure-backend`，不把“混淆”冒充“加密”。
2. **渲染层边界**：`secrets` 域只提供 `isAvailable / list / set / delete / getMasked`，**刻意不提供取明文方法**；业务代码在主进程内直接 `getSecret()`。
3. **禁止硬编码**：gitleaks 默认规则集（`.gitleaks.toml` 的 `useDefault = true`）三道闸门：
   - pre-commit：`gitleaks git --staged`（软闸门，未安装则提示跳过）
   - pre-push 与 CI：`pnpm check:secrets-git`（只扫待推送区间；未安装即失败）
   - 手动排查：`pnpm check:secrets`（`gitleaks dir .`，含未提交内容与本地缓存）
   - ⚠️ **不要删除 `useDefault`**：gitleaks 一旦找到配置文件就替代默认规则集，缺这一行等于规则数归零、三道闸门全部静默空转（2026-09-22 实测修复）。
4. **代理凭据**：URL 内嵌的用户名/密码在 `settings:set` / 导入 / 启动迁移时拆出，经 `safeStorage` 存入 keychain 保留键（`__proxy_auth`），`app_settings` 只保无凭据 URL。设置导出与诊断包均脱敏 URL；渲染层只拿到 `hasAuth` / `authUsername` 派生状态，`secrets` 域拒绝访问保留键。加密不可用时拒绝保存凭据（不回退明文）。
5. **`.env`**：仅主进程 `process.loadEnvFile()` 在 whenReady 前加载；文件不入仓。
6. **测试密钥**：用显式 fake 值（`fake-token` 风格）；日志禁止输出密钥（只记掩码 / 存在性）。

### 数据静态加密边界

SQLite 主库（`app_settings` 与派生业务表）默认使用标准 better-sqlite3，**不启用 SQLCipher，落盘为明文 SQLite 文件**；只有 `keychain.dat` 中的凭据由 safeStorage 加密。派生项目若存 PII、医疗/金融等敏感业务数据，必须在接入业务表前选择 SQLCipher 兼容驱动（如 `better-sqlite3-multiple-ciphers`）或依赖 OS 全盘加密；模板不默认引入，以避免驱动替换、ABI 重编与密钥轮换复杂度。

## 四、输入验证与文件访问

1. **IPC**：所有入参过 zod（定义表单一真源，`register.ts` 统一 wrap），响应契约同样校验；来源必须是主 frame 且通过 URL 白名单。
2. **文件路径**：`dialog:pickFiles` 选中的**文件**写入 `infra/file/user-grants.ts`（realpath 规范化 + LRU 200 条）；`dialog:pickDirectory` 只返回目录路径、不登记授权（目录粒度会放大到其下全部文件）。业务读取用户文件前查询 `isUserGrantedRead`，不自行拼接路径。
3. **外链**：`app:openExternal` 先 `new URL()` 解析，再只放行 `http:`/`https:`；拒绝 `file:`、自定义 scheme 与畸形字符串。
4. **SQL**：Drizzle 绑定参数，禁止字符串拼接（18-data-layer-spec）。
5. **外部数据**：设置导入文件先过版本与白名单，再逐键过值级 zod schema；任一白名单键的值非法则整批拒绝、库零写入；白名单外字段丢弃。

## 五、渲染层安全

1. **XSS**：Markdown 渲染（关于页 release notes）先 `remark-gfm` 再 `rehype-raw` + **`rehype-sanitize`**；禁止新增 `dangerouslySetInnerHTML`（确需时须评审并说明来源可信）。
2. **远程内容**：模板不加载远程 HTML / iframe；未来接入网页承载时使用 `WebContentsView` + 独立 session 分区，不回渲染层 iframe。
3. **依赖**：`pnpm audit:registry`（moderate 起卡关）、`pnpm knip`（死依赖减少攻击面）。

## 六、构建与发布安全

- `asar: true` + `embeddedAsarIntegrityValidation` + `onlyLoadAppFromAsar`（详见 `electron-builder.yml` 注释）。
- Electron fuses：`runAsNode: false`（关 `ELECTRON_RUN_AS_NODE`，防 LOLBin 绕过 asar）、`onlyLoadAppFromAsar: true`、`enableEmbeddedAsarIntegrityValidation: true`；新增需要子进程的业务改用 `utilityProcess`，不要为此改回 `runAsNode`。
- 签名/公证凭据只从 CI secrets 注入；未配置时构建跳过签名，不将就假签名。

## 七、依赖与供应链

- 版本更新主轨 = Renovate（`renovate.json`：周末批次、非 major 合并、electron major 人工评审、`minimumReleaseAge`）。
- Dependabot 只保留**安全更新**（`open-pull-requests-limit: 0`），避免与 Renovate 双轨重复 PR。
- pnpm 安装侧发布年龄闸（`minimumReleaseAge: 1440`）拦截「发布不足 24h」的版本，防依赖投毒。
- GitHub Actions 第三方 action 统一 pin 到 commit SHA（注释保留版本号），由 Renovate 的 `helpers:pinGitHubActionDigests` 维护 digest；发布工作流权限最高，不允许 tag 浮动。

## 八、检查清单

- [ ] 新 IPC：zod 入参 + 响应契约（L2 自动生效）
- [ ] 新文件读取：走 user-grants 授权表，不自行拼路径
- [ ] 新凭据：safeStorage + secrets 域，渲染层无取明文通道
- [ ] 新 Markdown / HTML 出口：sanitize 后再渲染
- [ ] 日志无敏感信息；测试用 fake 值
- [ ] `pnpm check:secrets-git` 通过（pre-push 自动执行）
