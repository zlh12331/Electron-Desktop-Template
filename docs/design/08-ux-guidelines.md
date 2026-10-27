# 08 · UX 设计规范（模板版）

> 面向模板当前真实界面：应用外壳 + 欢迎页 / 关于页 + 设置 + 命令面板。
> 内容是「接入业务时必须守住」的体验底线，不是上游产品的功能清单。
> 最后同步：2026-10-22（模板版重写：删除已剥离的会话/文件树/终端/审批等业务交互）

---

## 1. 五条原则

| 原则 | 含义 | 落地 |
|---|---|---|
| **实事求是** | 没有后端支撑的能力不渲染假 UI；未实现的功能明确标注「未提供」 | 设置分区注册表只登记真实分区；空面板不放大按钮 |
| **令牌唯一** | 颜色 / 字号 / 圆角 / 层级一律走 `styles/tokens.css`（Style Dictionary 生成物） | `check:tokens` / `check:css-vars` 卡关裸色值与未定义变量 |
| **键盘可达** | 每个交互都有键盘路径，且焦点可见 | Radix 原语 + `focus-visible` + 快捷键帮助表 |
| **状态诚实** | 异步数据必须呈现加载 / 刷新 / 空 / 错误 / 就绪五态 | `AsyncBoundary` + `useAsyncView`（§5.1） |
| **克制** | 桌面工具优先信息密度，不做装饰性动效与假氛围 | 动效只用于状态变化；`prefers-reduced-motion` 全局降级 |

## 2. 信息架构与布局

```
┌──────────────────────── topbar（--topbar-h = 52px）────────────────────────┐
│ 折叠侧栏 · 品牌/版本 …                   命令面板 · 更新指示 · 主题        │
├────────────┬──┬────────────────────────────────────────────┬──┬───────────┤
│ sidebar    │R │                main                        │R │ right     │
│ 200–400px  │6 │        欢迎页 / 关于页 / 业务页            │6 │ panel     │
│            │px│                                            │px│ 260–360px │
└────────────┴──┴────────────────────────────────────────────┴──┴───────────┘
```

实现：[AppShell.tsx](../../src/renderer/components/layout/AppShell.tsx) + [layout.css](../../src/renderer/styles/layout.css)。

- **侧栏**（`Sidebar.tsx`）：模板只保留「关于 / 设置」两个入口，由 `NAV_ITEMS` 数据驱动——接入业务时替换数组，不改结构。
- **右面板**：模板默认折叠且内容为空（`<aside className="right-panel" />`）。需要工作区时在 `components/layout/` 新建面板并挂进 AppShell。
- **折叠与断点**：列宽来自 CSS 变量，拖拽由 `use-resizable-panels` 覆盖；窗口 <1200px 自动折右面板、<900px 自动折侧栏，用户手动操作后断点不再覆盖（`manual` 位）。
- **浮层层级**：`--z-base(1) < --z-surface(2) < --z-raised(10) < --z-popover(50) < --z-modal(100) < --z-boundary(999)`；新浮层复用档位，禁止裸 `z-*` 数字。Toast（sonner）使用库默认层级，不参与应用内竞争。
- **对话框**：设置是全屏 Sheet（非路由），命令面板 / 快捷键帮助是覆盖层；三者状态收敛在 `ui-store`，由 `AppShell` 统一挂载。危险操作走命令式 `confirm()`（`confirm-dialog-store`），禁止内联 AlertDialog。

## 3. 设计体系

- **令牌真源**：`tokens/aurora.json` → `Style Dictionary` → `styles/tokens.css`；禁止手改生成物（`tokens:check` 校验同步）。
- **主题**：`light / dark / system` 三值，默认 `dark`；顶栏按钮与 `Ctrl/Cmd+Shift+T` 都按 `dark → light → system → dark` 循环。`ThemeProvider` 只负责给 `<html>` 切 class 并监听系统主题，组件禁止直接改 DOM。
- **字号**：`--font-size-2xs(10) → 3xl(28)` 九档；正文默认 `sm/base/md`。
- **圆角**：`--radius: 8px`，`--radius-sm/md/lg/xl` 派生。间距走 Tailwind 的 `gap-*` / `p-*`，不自定义像素阶梯。
- **样式分区**：`tokens` / `base` / `layout` / `palette`（命令面板）/ `motion`。业务样式接入时新建文件并在 `styles/index.css` 登记，不沿用上游类名。
- **动效**：集中走 `lib/motion/`（`transitions` / `variants`）与 `styles/motion.css`；`check:animations` 校验 keyframes 存在；全局响应 `prefers-reduced-motion`。
- **对比度**：正文与图标文字 ≥ 4.5:1，组件边界 / 焦点环 ≥ 3:1（WCAG 2.1 AA）。新增或修改令牌必须双主题实测，禁止只在一个主题下验收。

## 4. 页面与设置

| 界面 | 实现 | 形态 |
|---|---|---|
| 欢迎页 `/` | [home.tsx](../../src/renderer/routes/home.tsx) | 品牌 + 三张能力卡片 + 「打开设置」动作；接入方通常第一个替换它 |
| 设置 | [SettingsDialog.tsx](../../src/renderer/components/settings/SettingsDialog.tsx) | 全屏 Sheet，左导航 160px + 右内容区；每个分区独立错误边界 |

设置分区由注册表驱动（[sections/registry.tsx](../../src/renderer/components/settings/sections/registry.tsx)），分区 id 在 `lib/settings-sections.ts`：

| 分组 | 分区 | 消费真源 |
|---|---|---|
| 通用 | 常规 / 外观 / 通知 | 语言、开机自启、缩放、通知总开关 |
| 高级 | 数据 / 凭据 / 代理 / 快捷键 | 导入导出与备份、safeStorage 掩码、代理三模式、快捷键冲突检测 |
| 关于 | 关于 | 版本、运行时、更新状态、诊断包 |

**新增分区**：`settings-sections.ts` 加 id → `sections/<name>-section.tsx` → `registry.tsx` 加一条。导航分组、图标与组件在注册表一处声明，禁止第二套 switch。

**命令面板**（`Ctrl/Cmd+P` 或顶栏按钮）：模板内置设置 / 关于 / 主题三条命令；新增命令只改 `CommandPalette.tsx` 的 `COMMANDS` 数组。

## 5. 反馈与异常

### 5.1 异步五态（`AsyncBoundary`）

```
loading（>200ms 才显示骨架，防闪烁） → ready
loading → error（可重试 / 恢复动作）
ready → refreshing（保留旧数据 + 顶部细条） → ready
ready → empty（EmptyState，有 CTA 才放按钮）
```

所有 IPC 查询统一用 `AsyncBoundary` + `useAsyncView`，不手写 loading / error 分支。

### 5.2 错误边界三层

| 层 | 组件 | 范围 |
|---|---|---|
| 应用 | `AppErrorBoundary` | 整棵 React 树；全屏兜底 + 崩溃报告深链 |
| 路由 | `RootErrorBoundary`（`routes/root.tsx`） | 路由渲染 / 懒加载失败 |
| 分区 | `SectionErrorBoundary` | 侧栏 / 主内容 / 设置分区局部降级 |

⚠️ 必须用 `FallbackComponent`（而非 `fallbackRender`）挂载：React Compiler 会给函数注入 memo hook，类组件 render 路径没有 hooks dispatcher，直接调用会抛「Invalid hook call」。

### 5.3 其他反馈通道

- **Toast**：错误 / 成功统一 `toast.error(unwrapErrorMessage(...))`；错误文案按 `AppError.code` 查 `errors.json`。
- **更新**：顶栏 `UpdateIndicator` 常驻显示状态；就绪时弹 `UpdateNotice`（`update-store` 推送）。
- **通知**：模板唯一的系统通知是「首次最小化到托盘」的引导提示，受设置总开关门控。
- **浏览器模式**：`pnpm dev:web` 由 `dev/mock-api.ts` 注入假 `window.api`；组件不得直接访问 `window.api`，一律经 hooks / lib 封装（`check:ui-consistency` 卡关）。

## 6. 键盘交互

可配置项（默认值来自 `settings.shortcuts`，冲突检测见 `lib/shortcut-conflicts.ts`）：

| 动作 | 默认键 | 可配置 |
|---|---|---|
| 命令面板 | `Ctrl/Cmd+P` | ✅ |
| 打开设置 | `Ctrl/Cmd+,` | ✅ |
| 切换主题 | `Ctrl/Cmd+Shift+T` | ✅ |

固定键（在 `use-keyboard-shortcuts.ts` 中硬绑定，与快捷键帮助表同源）：

| 动作 | 键 |
|---|---|
| 快捷键帮助 | `?` / `F1` |
| 命令面板（备用） | `Ctrl/Cmd+K` |
| 折叠侧栏 | `Ctrl/Cmd+B` / `Ctrl/Cmd+1` |
| 折叠右面板 | `Ctrl/Cmd+J` / `Ctrl/Cmd+2` |
| 放大 / 缩小 / 复位 | `Ctrl/Cmd+=` / `-` / `0`（11 档，50%–200%） |

**可达性要求**：所有可聚焦元素有 `focus-visible` 指示；模态打开后焦点进入内部、关闭后返回触发器（Radix 默认）；图标按钮必须有 `aria-label`；跳过导航链接 `#main-content` 常驻 DOM。

## 7. 文案与国际化

- 语言：`zh-CN`（默认）/ `en`，双语言 key 集合必须一致（`check:i18n --strict`）。
- 新增文案：`useTranslation` 的 `t('域.语义')`，同时在两个语言包添加；错误码文案进 `errors.json`。
- 不翻译：快捷键键位、错误码、路径、命令等技术标识。

## 8. 验收清单

- [ ] 无硬编码颜色 / 任意像素值；新浮层引用既有 z-index 档位
- [ ] 深浅两主题都检查：正文 ≥4.5:1、边界与焦点环 ≥3:1
- [ ] 异步数据走 `AsyncBoundary` 五态；错误可重试或有恢复动作
- [ ] 空态有说明，不出现白屏或「假数据」
- [ ] 键盘可完成主路径；图标按钮有 `aria-label`；焦点可见
- [ ] 新文案双语言同步；未实现能力明确标注
- [ ] 重组件（设置 / 命令面板 / 快捷键帮助）保持 `lazy()`

## 9. 未提供（不要伪造）

模板不含：会话与消息流、文件树与编辑器、终端、Git 面板、浏览器预览、审批卡片、模型服务与 MCP。
接入时按 [09 前端实现指南](09-ux-interaction-spec.md) 的分层重建，不要恢复上游的样式类名或占位界面。
