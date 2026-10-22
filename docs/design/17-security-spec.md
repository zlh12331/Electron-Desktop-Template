# 17 · 安全规范（Electron 生产级基线）

> 对齐 Electron 官方安全清单与 OWASP 桌面应用实践，按模板当前实现（sandbox / CSP / safeStorage / zod / fuses）制定。
> 最后同步：2026-10-22（模板版：命令与实现路径按当前代码订正）

---
> 🔒 工程化强制：`check:csp-hash`（CSP 内联哈希）+ `check:secrets-git`（pre-push / CI）+ `check:secrets`（全仓自查）+ `check:devtools`（产物不含 devtools）

## 一、进程隔离（不可回退）

| 项 | 现状 | 约束 |
|---|---|---|
| `sandbox: true` | ✅ `window.ts` | 不可回退 |
| `contextIsolation: true` / `nodeIntegration: false` | ✅ | 渲染层只能经 `contextBridge` 暴露的 `window.api` |
| preload 零第三方运行时 | ✅ CJS + 纯字符串 `IPC_META` | 禁止引入 zod 等 ESM 包（沙箱下静默失败，`window.api` 变 undefined） |

## 二、CSP 与导航

- **CSP**：`src/main/security/csp.ts` 对 `defaultSession` 统一注入；产线 `script-src` 只认自身、wasm 与**一个内联脚本哈希**（`check:csp-hash` 卡关——改 CSP 或 `index.html` 内联脚本必须同步重算）。
- **开发期**放宽项（Vite HMR / React DevTools）只在 `!app.isPackaged` 生效，禁止进产线策略。
- **导航**：`will-navigate` 拦截站外跳转；`setWindowOpenHandler` 统一改为系统浏览器打开；外链只走 `app:openExternal`。
- **权限**：`setPermissionRequestHandler` 白名单式收口，渲染层系统权限请求一律拒绝（当前无任何授权项）。

## 三、密钥与凭据

1. **存储**：Electron `safeStorage` 加密落 `userData/keychain.dat`（Windows DPAPI / macOS Keychain / Linux libsecret）；写入用 `0o600` 临时文件原子替换，Windows 额外用 `icacls` 断继承、仅授予当前用户（纵深防御，失败只告警）。
2. **渲染层边界**：`secrets` 域只提供 `isAvailable / list / set / delete / getMasked`，**刻意不提供取明文方法**；业务代码在主进程内直接 `getSecret()`。
3. **禁止硬编码**：gitleaks 默认规则集（`.gitleaks.toml` 的 `useDefault = true`）三道闸门：
   - pre-commit：`gitleaks git --staged`（软闸门，未安装则提示跳过）
   - pre-push 与 CI：`pnpm check:secrets-git`（只扫待推送区间；未安装即失败）
   - 手动排查：`pnpm check:secrets`（`gitleaks dir .`，含未提交内容与本地缓存）
   - ⚠️ **不要删除 `useDefault`**：gitleaks 一旦找到配置文件就替代默认规则集，缺这一行等于规则数归零、三道闸门全部静默空转（2026-09-22 实测修复）。
4. **`.env`**：仅主进程 `process.loadEnvFile()` 在 whenReady 前加载；文件不入仓。
5. **测试密钥**：用显式 fake 值（`fake-token` 风格）；日志禁止输出密钥（只记掩码 / 存在性）。

## 四、输入验证与文件访问

1. **IPC**：所有入参过 zod（定义表单一真源，`register.ts` 统一 wrap），响应契约同样校验。
2. **文件路径**：用户经系统对话框选中的路径写入 `infra/file/user-grants.ts`（realpath 规范化 + LRU 200 条）；业务读取用户文件前查询 `isUserGrantedRead`，不自行拼接路径。
3. **SQL**：Drizzle 绑定参数，禁止字符串拼接（18-data-layer-spec）。
4. **外部数据**：设置导入文件在边界校验后才落库；未知字段按白名单丢弃。

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

## 八、检查清单

- [ ] 新 IPC：zod 入参 + 响应契约（L2 自动生效）
- [ ] 新文件读取：走 user-grants 授权表，不自行拼路径
- [ ] 新凭据：safeStorage + secrets 域，渲染层无取明文通道
- [ ] 新 Markdown / HTML 出口：sanitize 后再渲染
- [ ] 日志无敏感信息；测试用 fake 值
- [ ] `pnpm check:secrets-git` 通过（pre-push 自动执行）
