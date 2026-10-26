# 21 · 前端状态管理规范（四层架构）

> 基于模板当前实现：React Compiler + Zustand 5 + TanStack Query 5 + IPC 事件流。
> 最后同步：2026-10-26

---

## 一、四层架构（强制分层）

| 层 | 工具 | 职责 | 模板中的实例 |
|---|---|---|---|
| L1 | `useState` / `useRef` | 组件内瞬态 | 命令面板搜索词、表单输入、折叠/编辑态 |
| L2 | Zustand `persistent/` | 跨重启（写穿透 SQLite） | `settings-store`（主题 / 语言 / 快捷键 / 窗口 / 通知 / 代理 / 缩放） |
| L2 | Zustand `transient/` | 本次运行 | `ui-store`（对话框 / 折叠）、`update-store`、`confirm-dialog-store` |
| L3 | TanStack Query | IPC invoke 请求-响应 | 系统状态、日志、备份、凭据掩码、更新状态/缓存 |
| L4 | IPC 事件订阅 | 主进程推送 → 写 L2 | `update:event:status` / `settings:event:changed` / `invalidation:event:domains` / `app:event:deepLink` / `app:event:loginItemChanged` |

**核心原则**：服务端数据与客户端状态分离；配置型数据必须走后端单一真源，禁止渲染层手写第二份默认表。平台无关的默认值真源在 `packages/shared/src/constants/settings-defaults.ts`，渲染层 store 与主进程消费方共用；快捷键默认因依赖平台修饰键仍在渲染层维护。

## 二、判定标准

1. **IPC invoke 拉取型** → L3（缓存 / 去重 / 重试 / 失效 / 竞态）。
2. **IPC 持续推送** → L4 订阅，直写 L2 transient；卸载时调用 unsubscribe。
3. **跨组件共享的纯 UI 态** → L2 transient。
4. **组件独享** → L1，禁止为单组件引入 store。

## 三、工程化约束

- **queryKey 常量**：查询逻辑放 `hooks/` 域文件并导出 query key 常量，禁止组件内联字面量（`check:ui-consistency` 的 `inline-query-key` 卡关）。
- **响应解包**：一律 `unwrap()`（`lib/ipc.ts`），禁止手写 `'data' in resp` 判别。
- **mutation**：`useMutation` 必须挂 `onError` → `toast.error(unwrapErrorMessage(...))`。
- **selector 稳定性**：selector 只返回 store 的原始引用；过滤 / 派生放在 hook 体内。返回新数组 / 新对象会触发 `useSyncExternalStore` 无限循环。
- **React Compiler**：新代码默认不写 `useMemo` / `useCallback`。但 **vitest 不跑 Compiler**——effect 依赖的函数身份必须用 ref 固定（`use-latest-ref` 是现有样板），不能依赖编译器。
- **危险操作**：走命令式 `confirm()`（`confirm-dialog-store`），禁止内联 AlertDialog。
- **桥接挂载**：所有 IPC 订阅集中在 `components/layout/bridges.ts` 的 `useAppBridges()`，新增订阅只改这一个文件。

## 四、缓存失效

主进程写路径声明受影响域 → `invalidation:event:domains` → `use-invalidation-bridge` 按域前缀失效 L3 缓存。域词表 `INVALIDATION_DOMAINS` 是主进程与渲染层的共同真源，禁止散写字面量。详见 [data-ownership.md](data-ownership.md)。

> 接入业务写路径时调用 `broadcastInvalidation(domains)`；保留该骨架是为了让
> “写路径声明失效域”的模式不靠临时设计。
<!-- notes-example:start -->
> 现有生产发送方是 Local Notes 参考切片：create/update/delete/importFile 成功后广播
> `notes` 域，渲染层按 `NOTES_QUERY_KEY` 前缀刷新列表与详情。
<!-- notes-example:end -->

## 五、检查清单

- [ ] 查询类数据走 L3，不手写 `useEffect` 拉取
- [ ] 事件订阅在卸载时退订
- [ ] 跨组件 UI 态进 L2；组件独享留 L1
- [ ] selector 不返回新引用
- [ ] effect 依赖的函数身份有 ref 兜底（测试环境无 Compiler）
- [ ] 配置项不在渲染层维护第二份默认值
