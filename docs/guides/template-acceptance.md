# 派生项目验收（template acceptance）

> 适用：改动 `scripts/init-template.ts`、`scripts/postinstall-rebuild.mjs`、品牌 / 打包 / 发版基线之后，
> 或把模板交付给团队前。
> 结论先行：源仓库 `pnpm verify:local` 全绿 ≠ 派生项目可用；必须用干净副本走一遍真实用户路径。

## 快速入口

```bash
pnpm acceptance:derived          # 全新安装 → 初始化/幂等 → 门禁 → E2E → 打包/smoke
pnpm acceptance:derived --nsis   # 追加 NSIS 安装 → 启动 → 卸载（仅 Windows）
pnpm acceptance:nsis --installer release/xxx.exe --yes  # 单独验证已构建的安装包
```

脚本在仓库外创建干净副本，成功自动删除，失败保留现场（`--keep` 成功也保留）。
`--skip-e2e` / `--skip-build` 可用于快速迭代；NSIS 会真实安装/卸载测试应用，
建议在一次性 VM 或测试账号中执行。

## 一、为什么必须做

模板的常规门禁都在**源仓库**里运行：品牌是模板自己的值、依赖已安装、运行数据已存在。
而 `init:template` 会改写品牌、把版本基线重置为 `0.0.0`、删除模板专用的 `bootstrap-sha`，
并在改写首帧主题脚本时重算 CSP 哈希。这些路径在源仓库测试中不可见。

2026-10-23 的验收实际抓到三类缺陷：
- 初始化改了 `index.html` 的存储前缀，却没同步 `csp.ts` 哈希：派生项目 `check:brand` 通过、
  `check:csp-hash` 失败
- 当前 Electron 包不再自带 postinstall，全新 `pnpm install` 后缺二进制，`pnpm dev` 报
  `Electron uninstall`
- 脚本测试硬性要求 `bootstrap-sha` 存在，但初始化本来就会删除它

三类都不是源仓库单测能覆盖的，因此每次动模板底座都要重跑本流程。

## 二、隔离要求

- 副本放在**仓库外**，不要放进 `.tmp/`：Biome 的 `files.includes` 会忽略整个 `.tmp`，
  lint 会以「0 files」通过，验收变成假绿。
- 不配置远端、不 push、不发 Release。
- 使用独有品牌与协议（示例：`Derived Acceptance Lab` / `derived-acceptance-20261023`），
  避免和真实应用、现有 E2E 的 userData 冲突。
- 打包态 smoke 会写真实 `%APPDATA%`（Windows）并注册协议；结束后按第六节清理。

## 三、手工流程（脚本不可用或排障时）

以下步骤与 `pnpm acceptance:derived` 等价，仅用于脚本本身出问题或需要逐段排查时。

```bash
mkdir -p <outside-dir>
git archive --format=tar HEAD | tar -xf - -C <outside-dir>
cd <outside-dir>
git init -b main
```

Windows 可在 Git Bash 或系统自带 `tar.exe` 下执行。不要复制 `node_modules`、
`.electron-user-data*`、`.e2e-user-data*`、`out/` 或 `release/`。

## 四、验收步骤

### 4.1 全新安装

```bash
pnpm install --frozen-lockfile
```

确认 `node_modules/electron/path.txt` 与对应 `dist` 二进制存在。根 `postinstall` 现在会调用
Electron 官方安装器并校验，失败即阻断安装；若跳过该钩子，后续 `pnpm dev` 会报
`Electron uninstall`。

### 4.2 初始化与静态检查

```bash
pnpm init:template --name "Derived Acceptance Lab" \
  --app-id com.example.derived-acceptance \
  --protocol derived-acceptance-20261023 \
  --owner template-acceptance --repo local-only \
  --author "Template Acceptance" --dry-run   # 只报告，不落盘

# 去掉 --dry-run 正式执行；随后用同一组参数再跑一次，应输出「无改动」
pnpm check:brand
pnpm check:csp-hash
pnpm typecheck && pnpm lint
pnpm test:scripts
```

判定：dry-run 不落盘；正式执行得到目标状态；第二次执行 0 改动；`check:brand` 与
`check:csp-hash` 通过；脚本测试必须能在派生状态下通过（不能依赖模板专用的 `bootstrap-sha`）。

### 4.3 真实启动与持久化

```bash
pnpm test:e2e:electron electron.spec.ts
```

至少覆盖：窗口标题 / 品牌、`window.api` 注入、IPC `settings` 快照、主题切换后**完全退出
再启动**的持久化。该用例使用独立 userData 子目录，并在结束后清理。

### 4.4 产物与 smoke

```bash
pnpm build:win:x64        # 或当前平台对应命令
pnpm check:native-arch
pnpm test:smoke
```

判定：安装包生成；原生模块架构与目标一致；生产包 6 项 smoke 全过、无控制台错误、
启动到可交互在预算内。

> 这一步验证的是 `release/<platform>-unpacked`。NSIS 安装/卸载由
> `pnpm acceptance:derived --nsis` 或 `pnpm acceptance:nsis --installer <exe> --yes`
> 单独验证；两者都会安装/卸载唯一品牌的测试应用并清理协议与 userData。

## 五、判定与处置

全部通过才算验收完成。任何一步失败都视为**模板缺陷**：在源仓库修复并补回归测试，
然后从干净副本重跑；不要只修副本——副本是一次性的。

本次基线（2026-10-23）：550 个受控文件、1085 个依赖、E2E 7 passed / 1 skipped、
Windows x64 安装包 118 MB、原生架构 1/1、smoke 6/6、启动 2.17s。

## 六、清理

删除副本与构建产物后，清理运行态残留：

Windows PowerShell：

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\<executable-name>"
reg.exe delete "HKCU\Software\Classes\<protocol>" /f
```

macOS / Linux：删除 `~/Library/Application Support/<ProductName>` 或
`~/.config/<executable-name>`，并确认没有残留的协议注册。

## 七、已知未覆盖

- 自动更新端到端（无 Release 时更新 E2E 会跳过；可用本地 HTTP 更新源另测）
- macOS / Linux 打包（由 CI 六平台矩阵覆盖，但不在本机验收范围内）
- 安装器在真实用户机器上的签名/SmartScreen 行为（当前模板默认未签名）
