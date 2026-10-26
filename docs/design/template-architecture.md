# 模板架构：约束机器

> 本文说明**这个模板为什么这样组织**，以及每条约束由什么机器守着。
> 功能清单见 [README](../../README.md)，扩展方法见 [AGENTS.md](../../AGENTS.md)「扩展点速查」。
> 最后同步：2026-10-23（补充派生链路与安装钩子）

## 核心命题

模板的价值不在「功能多」，而在**把容易漂移的东西变成单一真源 + 机器门禁**。
功能可以少做，约束机器不能少——漏掉它，项目在三个月后必然退化成"每处写法都不一样"。

下面五条是这套机器的主干，每条都对应一组真实故障。

---

## 一、IPC 契约：定义表驱动

### 问题

Electron IPC 有五个天然漂移点：通道字符串在三端各写一遍、入参/出参类型手写、参数校验各写各的、
新增方法要改五处必漏、preload 在 `sandbox: true` 下**引入 zod 会静默失败**（`window.api` 变 `undefined`）。

### 不变量

- 通道字符串只有**一处**字面量（`packages/shared/src/ipc/meta.ts`）
- `window.api` 的形状由类型系统从定义表推导，不手写
- handler 缺失 = **编译期报错**；响应契约（`resSchema`）缺失 = **启动期抛错**
- 入参与响应都在主进程边界做 zod 校验
- preload 运行时依赖为零（只遍历纯字符串表）

### 布局与依赖方向

```
packages/shared/src/ipc/
├── meta.ts          # 零依赖：channel + kind（request/event）
├── domains/*.ts     # 每个域一个文件：meta + zod schema + res 类型标记
├── domains/index.ts # 域册（新增/删除域的唯一登记点）
├── definitions.ts   # 聚合：IPC_DEFINITIONS = IPC_DOMAINS
├── with-schema.ts   # 装配原语（withSchema / withPayload）
├── derive.ts        # 类型推导 + deriveChannels
├── channels.ts      # IPC_CHANNELS（由 meta 派生）
├── api.ts           # IpcApi（由定义表推导）
└── response.ts      # IpcResponse<T>

src/preload/utils/create-api.ts   # 遍历 meta 生成 window.api
src/main/ipc/register.ts          # 遍历定义表统一注册
src/main/ipc/wrap.ts            # sender 校验 + zod 双向校验 + traceId
```

依赖方向严格单向：`meta` ← `domains` ← `definitions` ← `channels` / `api`。
**preload 只允许 import `meta.ts` / `channels.ts`**，禁止 import 任何含 zod 的模块。

### 为什么 `domains/` 拆文件而不是一张大表

一张 1200 行的 `definitions.ts` 会让「删掉一个业务域」变成逐段编辑的高风险操作。
拆成 `domains/<domain>.ts` 后，剥离业务 = 删文件 + 删域册一行 + 删 handler 一行，
漏删在编译期暴露（`InferHandlers` 依赖域键推导 handler 形状）。

### 真实坑

1. **preload 必须是 CJS**：`sandbox: true` 限制下 ESM 会静默失败，`window.api` 为 `undefined` 且无报错
2. **`resSchema` 必须必填**：曾设为可选，新方法漏配会让「响应防漂移」静默失效——现由 `register.ts` 启动期断言
3. **sender 白名单**：打包态只认产物 `index.html`，dev 只认 dev server origin，防外来 webContents 调用

---

## 二、错误模型：单一出口 + 单一解包口

### 问题

跨进程错误丢栈、文案散落各处、`any` 蔓延、每个组件自己判断 `'data' in res`。

### 不变量

- 所有 handler 异常归一为 `AppError`（带 `ErrorCode`），由 `wrap()` 统一包装
- 渲染层只有一个解包口 `unwrap()`（`src/renderer/lib/ipc.ts`），禁手写 `'data' in` 判别（`check:ui-consistency` 的 `manual-unwrap` 卡关）
- 错误码文案的单一真源在 `i18n/errors.json` + `ERROR_META`，`useErrorMessage` 按 code 查
- 报错落本地日志（`utils/error-report.ts` / `lib/error-report.ts` 两个出口），不依赖云端

### 真实坑

`toast.error(error.message)` 直出会把 `[CODE] 原始信息` 甩给用户——统一走
`unwrapErrorMessage(error, getErrorMessage)`（`check:ui-consistency` 的 `raw-error-toast` 卡关）。

---

## 三、数据层：schema 单一真源 + 损坏自愈

### 问题

建表 SQL 与 ORM schema 双写必漂移；迁移链断裂在用户机器上才暴露；断电/强杀留下坏库。

### 不变量

- `src/main/infra/storage/schema.ts` 是**全库唯一真源**，迁移 DDL 由 `drizzle-kit generate` 派生，禁止手写第二份
- 迁移按 `_journal.json` 的 `when` 前进执行，`__drizzle_migrations` 幂等记录
- 启动期热备份轮转 + `quick_check` 判损坏 → 从最近健康备份恢复
- **被外键引用的表不能重建式迁移**（会触发 `ON DELETE CASCADE` 清空数据）——改用触发器兜底

### 真实坑

旧库升级时若迁移链被重建（`0000` 重新生成），老库的迁移记录与新基线对不上，
启动会报 `table already exists`。解法是登记一条「基线重定位」记录（见 `db.ts` 的
`rebaseLegacyMigrationBaseline`），而非让用户删库。

---

## 四、棘轮治理：存量债务只能变小

### 问题

存量债务一放就烂：豁免清单只增不减、基线越调越松、"下次再修"永不到来。

### 不变量

每个度量门禁都有**只许收紧的基线**：

| 门禁 | 度量 | 基线文件 |
|---|---|---|
| `check:tsdoc` | export 符号缺 TSDoc | `scripts/tsdoc-baseline.json` |
| `check:file-size` | 单文件净行 ≤600 | `scripts/check-file-size.baseline.json` |
| `check:functions` | 形参 ≤4 / 函数体 ≤200 | `scripts/check-functions.baseline.json` |
| `check:complexity` | 认知复杂度 ≤15 | `scripts/check-complexity.baseline.json` |
| `check:coverage-floors` | 四层覆盖率下限 | `scripts/coverage-floors.json` |
| `check:ui-consistency` | 写法不一致命中数 + 设施采用率 | `scripts/ui-consistency*.json` |

收紧方式统一：修完一处 → 跑对应的 `--tighten` / `--update-baseline` → 基线下降。
**不允许为了通过而调松基线**；确需放宽必须显式评审并写进提交说明。

`scripts/**` 已纳入 `check:file-size` / `check:functions` / `check:complexity`（测试文件不计）。
首次纳入时的存量债务已登记在 `scripts/*.baseline.json`：`init-template.ts` 净行 735、
21 个复杂度文件/30 处；后续只允许收紧。

---

## 五、漂移门禁族

每一条都对应一种「静默腐化」：

| 门禁 | 拦什么 | 真实故障 |
|---|---|---|
| `check:comments` | 注释/文档里的失效文件路径、行号、`@param` 漂移、`pnpm` 命令不存在 | 文档指向已删文件，新人照着做必失败 |
| `check:docs-scripts` | 文档脚本表 ↔ `package.json` 不一致 | 文档里的命令实际不存在 |
| `check:docs-contracts` | IPC 计数/域清单、静态门禁数、`ErrorCode` 符号或代码路径引用过期 | 文档声称的契约与当前代码不一致 |
| `tokens:check` | 设计令牌生成物 ↔ 真源不一致 | 改了令牌忘了重新生成 |
| `check:csp-hash` | CSP 内联脚本 hash 未锚定 | 注释掉的旧脚本被静默放行 |
| `check:css-vars` | `var(--x)` 引用了未定义的变量 | 样式静默失效 |
| `check:animations` | `animation` 引用的 `@keyframes` 不存在 | 动画静默不播 |
| `check:brand` | 品牌位点与 `app.config.json` 不一致 | 改了产品名，安装包/窗口标题仍是旧的 |
| `check:schema-drift` | schema.ts ↔ 迁移文件漂移 | 本地能跑，新装用户建表失败 |
| `check:secrets-git` | 待推送区间含密钥 | 推上去即不可逆 |
| `check:i18n` | 引用缺失 / 双语不一致 / 冗余 key | 界面出现原始 key |

### 派生链路也是漂移面

源仓库门禁看不到初始化后的项目，以下链路额外受约束：

- `init:template` 同步品牌、把版本基线重置为 `0.0.0`、删除模板专用的 `bootstrap-sha`，在改写首帧主题脚本时重算 CSP 哈希，并同步 NSIS 安装宏里的 Windows 协议
- 模板营销站默认在初始化时移除；`--keep-site` 保留并改写产品名/仓库坐标，页面营销文案仍需人工调整。图标是二进制资产，不会自动替换——派生验收前替换 `resources/icons/icon.png` 并重跑托盘资产生成
- 根 `postinstall` 先安装并校验 Electron 二进制，再按 Electron ABI 重编 `better-sqlite3`；失败显式退出，不留下「能装不能跑」的状态

它们分别由 `scripts/init-template.test.ts` / `scripts/postinstall-rebuild.test.ts` 覆盖，
最终以 [派生验收指南](../guides/template-acceptance.md)为准。

---

## 六、CI/CD 与发版

- **CI on PR, CD on main**：`ci.yml` 由 `pull_request` 与 `merge_group` 触发；`release.yml` 只处理发版
- **必需检查用 summary job 暴露稳定名**：平台 label 换代只改 workflow，不改云端 ruleset；summary job 必须 `if: always()`（被跳过的必需检查 = 永不 report = PR 永久卡 pending）
- **发版三护栏**：合并纪律（CD 全绿才人工合并）/ 锚点检查（tag ↔ Release PR ↔ 待合并版本三态自洽）/ 内容边界（Release PR 只允许版本号 + CHANGELOG）
- **打包验证只在 CD**：`ci.yml` 不做六架构打包（与 `release.yml` 完全重复）；动打包链路的 PR 合并前本地跑 `pnpm build:win:x64` → `check:native-arch` → `pnpm test:smoke`
- **发布失败恢复**：CD 在 tag 前失败时不要只改 `autorelease: pending` label；按 [RELEASING §4.1](../../RELEASING.md) 用新版本走手动发布 PR，保证 tag 与产物一致。production smoke 依赖 inspect fuse，见 17 号安全规范。

---

## 七、扩展顺序（新项目接入业务时）

按依赖方向推进，每一步都能独立验证：

1. **数据层**：加表 → `drizzle-kit generate` → 写仓储函数（不写 SQL 字符串）
2. **契约**：`pnpm scaffold:ipc --domain <d> --method <m>` 生成骨架 → 换真实 schema
3. **主进程**：实现 handler（依赖经工厂注入）→ 补 handler 单测
4. **渲染层**：域 hook（`hooks/use-<domain>.ts`，导出 queryKey 常量）→ 页面组件
5. **失效**：`INVALIDATION_DOMAINS` 加词 + 主进程写路径广播 + `data-ownership.md` 登记

前三步走完就能用 `pnpm dev:web` + mock 把界面做出来，不必等主进程全部就绪。
