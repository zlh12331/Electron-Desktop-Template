# 11. 可访问性规范（a11y）

> 对齐 WAI-ARIA / WCAG 2.1 AA 最佳实践，基于项目实际组件体系（Radix 原语 + 自研组件）制定验收标准。
> 最后同步：2026-10-24（模板版：恢复针对保留界面的 axe 自动扫描）

---
> 🔒 工程化强制：Biome a11y 规则组（`noPositiveTabindex` / `noStaticElementInteractions` / `useButtonType` 等，lint 卡关）

## 一、对比度门槛（WCAG 2.1 AA）

### 1.1 硬性门槛

| 场景 | 门槛 | 说明 |
|---|---|---|
| 正文文本 | ≥ 4.5:1 | 小于 18pt（24px）或 14pt 加粗（18.66px）的文本 |
| 大文本 | ≥ 3:1 | ≥ 18pt 或 ≥ 14pt 加粗 |
| UI 组件边界（输入框/按钮描边/开关） | ≥ 3:1 | 区分组件与背景的视觉边界 |
| 图形对象（图标/徽章底色） | ≥ 3:1 | 有信息含义的图形 |
| 焦点指示环（focus-visible ring） | ≥ 3:1 | 与相邻背景对比 |

### 1.2 项目语义令牌保证

- 全部颜色走 Template 语义令牌（`--background` / `--foreground` / `--muted` / `--muted-foreground` / `--accent` 等），双主题各自保证对比：**新增/修改令牌时必须校验双主题对比度**，禁止引入低于门槛的派生色（检查清单见 §五）
- 文本色禁止单独使用 `text-muted-foreground` 承载关键信息（如错误提示需配合 `text-[var(--error)]` 或图标）
- 已知语义映射：徽章文字走「可读前景 + 可读底」组合。中性徽章用 `bg-muted text-muted-foreground`；错误徽章用 `bg-destructive text-destructive-foreground`。**不要用 `bg-error-text/10 text-error-text` 一类同色半透明底**——实测双主题均低于 4.5:1（暗色 4.42 / 亮色 4.42）

### 1.3 验证方法

- 自动化（强制）：`pnpm test:a11y` 用 `@axe-core/playwright` 扫描首页亮/暗双主题、关于页、设置全部分区、命令面板与快捷键帮助；规则集为 WCAG 2.0/2.1 的 A + AA（`wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa`），零违规才通过。CI 的 `e2e-browser` job 跑完整浏览器 E2E 时自动包含该用例。
- 手工：DevTools 对比度检查器（拾色器）抽检新页面 / 新令牌；axe 覆盖不到的键盘与焦点行为按 §2、§3 清单验收。

## 二、键盘导航验收清单

### 2.1 硬性要求（交互组件必过）

- [ ] 全部可交互元素可通过 Tab 顺序到达（`tabindex="0"` 或原生可聚焦元素）
- [ ] 自研组件**禁止** `div/span + onClick` 无 `role`/`tabIndex` 模式（已由代码规范禁止）
- [ ] 模态层（Dialog/Sheet/AlertDialog）打开后焦点进入内部、关闭后焦点返回触发器（Radix 默认实现，自研模态必须等价实现）
- [ ] Escape 关闭模态/菜单/对话框；再次触发可重新打开
- [ ] 下拉/菜单/标签页支持方向键导航（Radix 内置，自研需等价）
- [ ] 快捷键（Ctrl/Cmd+B/J、Ctrl/Cmd+K、F1 等）均有可见入口（快捷键帮助面板列出，不得"有快捷键无宣传"）
- [ ] 焦点可见：`focus-visible:ring-*` 应用于全部可聚焦元素，禁止 `outline-none` 不带替代指示

### 2.2 常见焦点陷阱（回归清单）

| 陷阱 | 验收 |
|---|---|
| 焦点困在模态内 | Tab 循环在模态边界内（Radix 焦点陷阱） |
| 关闭后焦点丢失 | 焦点回到触发器或合理落点（body 前移） |
| 隐藏元素可聚焦 | `hidden` / `aria-hidden` 元素不得 Tab 可达 |
| 自绘拖拽分隔条 | 必须有 `tabIndex=0` + ARIA 滑块语义 + 方向键步进（`AppShell` 的 resizer 是样板） |

## 三、焦点管理规则

1. **默认焦点策略**：模态 → 首个可聚焦元素或 DialogTitle；抽屉 → 关闭按钮；搜索类 → 输入框自动聚焦（`autoFocus` 或 effect focus）
2. **焦点顺序**：DOM 顺序即 Tab 顺序（禁止 `tabindex` 正数）；布局重排时用 DOM 调整而非 tabindex hack
3. **状态变更提示**：加载中（`aria-busy`）、进度（`role="progressbar"` / `role="status"`）、错误（`role="alert"`）
4. **图标按钮**：无可见文字必须 `aria-label`（模板抽查已覆盖：顶栏折叠 / 主题、侧栏导航、设置项开关）

## 四、语义与 ARIA

- 复杂交互组件必须基于 Radix 原语（Dialog / DropdownMenu / Tabs / Tooltip / AlertDialog / Select / Switch）——键盘导航与 ARIA 内置（10-component-design-spec 原则 ①）
- 自研交互组件必须显式 `role` + 状态属性（如 `role="switch"` + `aria-checked`）
- 模板入口约定：设置导航 `role="tablist"` + roving tabindex + `aria-controls`/`tabpanel`；命令面板打开时背景 `inert`、Tab 在面板内循环、关闭后焦点回到触发器；cmdk 负责 listbox 语义，每条导航/命令有可读名称

## 五、新功能/组件 a11y 检查清单

- [ ] 对比度：新增令牌双主题 ≥ 门槛（§1.1）
- [ ] 键盘：Tab 可达 + 焦点可见 + Escape/方向键等价（§2）
- [ ] 语义：Radix 原语优先；自研带 role/aria（§4）
- [ ] 文案：图标按钮 aria-label；状态变化 aria-live
- [ ] 自动化：Biome a11y 规则通过；新增/修改界面同步补入 `e2e/a11y.spec.ts` 的扫描范围并跑 `pnpm test:a11y`
