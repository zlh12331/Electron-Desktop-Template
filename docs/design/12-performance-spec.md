# 12. 性能规范

> 面向模板现状的性能门槛与纪律。数字为 2026-10-21 实测；随构建产物变化，以 `pnpm check:bundle` 输出为准。
> 最后同步：2026-10-21

---
> 工程化强制：`pnpm check:bundle`（构建产物门槛，超限卡关）+ `pnpm analyze:bundle`（体积报告）

## 一、Bundle 体积门槛

### 1.1 工具

- `pnpm analyze:bundle`（`ANALYZE_BUNDLE=1` + rollup-plugin-visualizer）产出报告到 `stats/`
- `pnpm check:bundle`：读 `out/` 产物比对门槛，超限即失败（无产物时跳过不卡关）
- `pnpm knip`：死代码 / 死依赖卡关（CI）

### 1.2 门槛（renderer，gzip 前）

| 指标 | 门槛 | 当前实测 | 说明 |
|---|---|---|---|
| 单个 chunk | ≤ 5120 KB | 1125 KB（SettingsDialog） | 路由级 lazy 已把页面拆出主包 |
| 渲染层总包（JS 合计） | ≤ 16384 KB | 3307 KB | 20 个 chunk |
| 首载同步体积 | ≤ 3072 KB | 2101 KB | `index.html` 的 script/modulepreload 合计，即 Electron 首帧必须下载的 JS |
| 主进程 bundle | 告警线 5120 KB | 471 KB | 只告警不卡关 |

门槛写在 `scripts/check-bundle.ts` 顶部的三个常量里，改门槛需同步改本节。

**收紧策略**：先有门槛卡住回退（新引入超限即失败），再渐进收紧。每轮重构后对比
`pnpm check:bundle` 输出的总包与首载体积，下降则同步下调常量。
`stats/bundle-history.json` 记录最近 30 次趋势，环比超过 ±15% 只告警不卡关。

### 1.3 依赖纪律

- **禁全家桶**：不为单组件引入整套库，评估三关：依赖清单 / 设计体系兼容 / Runtime 绑定
- **按需引入**：`lucide-react` 图标按名导入；Radix 按包引入（各自独立包，不引 meta 包）
- **tree-shake 友好**：导入走具名导出，禁止 `import * as` 大库
- 新增依赖前先看 `pnpm analyze:bundle` 后的增量，超过 150KB（gzip）需在 PR 里论证

## 二、渲染优化规则

### 2.1 已启用的机制（不得回退）

- **React Compiler**（`oxc-transform-react`，`compilationMode: 'infer'`）——自动 memo；
  生效性由 `pnpm check:compiler` 断言（构建产物须含 `react/compiler-runtime` 痕迹）
- **路由级 lazy**：`router.tsx` 里每个页面都用 `route.lazy` 动态 import，页面依赖不进首屏
- **设置抽屉与命令面板 lazy**：`AppShell.tsx` 用 `lazy()` 加载，首屏不含其依赖

### 2.2 规则

1. **zustand selector 稳定性**：selector 返回新数组/对象会触发 `useSyncExternalStore`
   无限循环——派生值必须用稳定引用（`useMemo`，或选择原始字段后在组件内组合）
2. **列表 key**：稳定唯一 key，禁止 index 用作可重排列表的 key（`check:ui-consistency`
   的 `index-key` 规则卡关；静态骨架屏确需 index 时用 `biome-ignore` 说明理由）
3. **事件订阅清理**：`subscribe` / 定时器卸载必清理，防泄漏（L4 IPC 订阅）
4. **重渲染边界**：子组件 props 用原始值 / 稳定引用；React Compiler 已自动处理时不要
   再手写 `useMemo` / `useCallback` 重复包裹
5. **高频事件合帧**：滚动、resize、拖拽等高频事件的状态写入统一走 rAF 合帧，
   一帧至多一次 setState（参考 `use-resizable-panels.ts`）
6. **查询缓存粒度**：TanStack Query 的 `staleTime` 按数据变化频率设置——静态运行时信息
   可用 `Number.POSITIVE_INFINITY`，日志类用 `0`

## 三、长列表

模板不含长列表场景（无会话流、无文件树）。接入时的经验：

| 场景 | 推荐方案 |
|---|---|
| 数千节点的树 | 用带虚拟化的库，不自己算可视区间 |
| 可分页的列表 | 原生滚动 + IPC 分页（请求带 `limit` / `offset`） |
| 数据量大但必须全量保留 | **分页窗口渲染**：数据全量留存、只裁剪 DOM |

**分页窗口优于真虚拟化的场景**：数据需要完整参与业务逻辑（如把全部历史作为上下文）
时，虚拟化会把「数据裁剪」与「DOM 裁剪」耦合成一件事；分页窗口只裁 DOM，业务侧无损。

真虚拟化（如 `@tanstack/react-virtual`）的触发指标（任一命中再评估）：

1. 单页渲染后 `document.querySelectorAll('*').length` > 8000
2. 连续滚动期间 PerformanceObserver longtask > 200ms 非零
3. 滚动/流式跟随时掉帧（持续击中 16ms 帧预算）

## 四、性能验证

### 4.1 自动化门槛

| 层 | 命令 | 卡关位置 |
|---|---|---|
| 构建产物体积 | `pnpm check:bundle` | `verify:local:full` |
| React Compiler 生效 | `pnpm check:compiler` | 同上 |
| React DevTools 可注入 | `pnpm check:devtools` | 同上 |
| 死代码 / 死依赖 | `pnpm knip` | CI quality |
| 首帧不闪烁 | E2E `smoke.spec.ts` 主题切换用例 | CI E2E |

### 4.2 手动排查

```bash
pnpm analyze:bundle   # 生成 stats/renderer-bundle.html（原始 JSON 数据，非 treemap）
pnpm preview          # 启动构建产物，配合 DevTools Performance 面板录制
```

主进程诊断：`electron --inspect=9229 .`，再用 `chrome://inspect` 连接，
在 Memory 面板取 heap snapshot 或做 Allocation instrumentation。

> Clinic.js 一类命令行 profiler 不适用：它们强制 `node` 前缀，无法 attach Electron
> 主进程。`--inspect` + DevTools 是零依赖且可行的路径。

### 4.3 接入业务后的建议

模板本身没有性能基准套件。接入业务时按需补：

- **主进程**：SQLite 查询（万级行 + `EXPLAIN` 验证索引命中）、外部进程吞吐
- **渲染层**：长列表 DOM 规模、滚动长任务、首载 JS 体积趋势
- **E2E**：Playwright + CDP 采集真实指标（Script/Layout 增量、longtask）
