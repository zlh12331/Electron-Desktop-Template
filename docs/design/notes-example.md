# Local Notes 参考切片（可删除的端到端示例）

> 这是模板里**唯一有意保留的业务示例**：不是产品功能，而是一条可运行、可测试、可整体删除的
> 全链路样本。派生项目默认在 `init:template` 时删除；需要保留学习时加 `--keep-example`。

## 1. 它演示了什么

| 层 | 演示点 | 落点 |
| --- | --- | --- |
| 契约 | zod 入参/响应 + `withSchema` 绑定 + 编译期双向校验 | `packages/shared/src/schemas/notes.ts`、`packages/shared/src/ipc/domains/notes.ts` |
| IPC | 7 个 request 通道（list/get/create/update/delete/importFile/exportFile） | `packages/shared/src/ipc/meta.ts`、`src/main/ipc/notes.handler.ts` |
| 数据 | Drizzle 表定义 + 迁移 + 仓储（搜索/预览/上限/排序） | `src/main/infra/storage/tables/notes.ts`、`src/main/infra/notes/notes-repository.ts`、`drizzle/0001_lazy_mad_thinker.sql` |
| 失效 | 写路径广播 `notes` 域，渲染层按 queryKey 前缀失效 | `src/main/ipc/notes.handler.ts`、`src/renderer/hooks/use-notes.ts` |
| 文件 | `dialog:pickFiles` 授权 → 主进程校验 `isUserGrantedRead` → 导入；导出走保存对话框 | `src/main/ipc/notes.handler.ts` |
| 状态 | TanStack Query 请求态 + 组件局部编辑态（父组件以 key 重置） | `src/renderer/routes/notes.tsx`、`src/renderer/components/notes/note-editor.tsx` |
| UI | 列表/搜索/空态/加载态/危险操作确认，全部走现有设施 | `src/renderer/components/notes/note-list.tsx`、`src/renderer/components/ui/textarea.tsx` |
| 深链 | `targetId` → `/notes/<id>`；目标缺失展示空态 | `src/renderer/hooks/use-deep-link.ts`、`src/renderer/routes/notes.tsx` |
| 测试 | schema/仓储/handler/hook/组件/浏览器 E2E/Electron 持久化/a11y | `packages/shared/src/__tests__/notes-schemas.test.ts`、`src/main/infra/notes/notes-repository.test.ts`、`src/main/ipc/notes.handler.test.ts`、`e2e/notes.spec.ts` |

边界：笔记正文按纯文本/Markdown 源码存储，不做富文本渲染；没有标签、附件、协作与同步。
这些是**业务决策**，模板不预置。

## 2. 本地运行

```bash
pnpm dev        # Electron：SQLite 持久化 + 文件导入导出 + 深链
pnpm dev:web    # 浏览器：内存 mock（刷新重置），验证 UI 与交互
pnpm test:e2e -- notes.spec.ts
pnpm test:e2e:electron -g "Notes 参考切片"
```

深链验证：已安装构建注册协议后，打开 `electron-template://open/<note-id>`（协议名随
`app.config.json` 改写）；未安装时可用 E2E 的启动参数方式覆盖冷启动路径。

## 3. 删除策略

### 3.1 派生项目（推荐）

`pnpm init:template` **默认删除**整套示例与它的迁移：

- 删除示例源码、i18n 键、侧栏入口、路由、mock、E2E 与本文档；
- 删除 `drizzle/0001_lazy_mad_thinker.sql`、对应 snapshot 与 journal 条目——全新派生项目的
  数据库从未创建 `notes` 表；
- 从 `meta.ts` 移除 7 个通道后，自动同步 `docs/design/19-ipc-spec.md` 的域/通道计数。

需要保留示例学习时加 `--keep-example`；此时删除清单与迁移都保持原样。

### 3.2 已在运行的派生项目

已启动过应用的数据库里**可能已经有 notes 表与数据**。删迁移文件不会回收表，所以独立移除
命令默认**保留迁移与表**，只删代码：

```bash
pnpm remove:notes-example --dry-run      # 先看会改哪些文件
pnpm remove:notes-example                # 删代码，保留表（无数据丢失）
pnpm remove:notes-example --drop-table   # 额外生成 DROP TABLE 迁移，下次启动清表（不可恢复）
```

`--drop-table` 通过 `drizzle-kit generate` 在迁移链尾部追加一条 `DROP TABLE notes`，
而不是改写历史迁移；生成失败时示例文件尚未删除，可修正配置后重跑。

### 3.3 手工删除

若不使用脚本，按 `scripts/lib/notes-example.ts` 的清单删除即可（标记块 + 文件 + i18n +
迁移 + 文档计数）。删除后跑 `pnpm typecheck && pnpm lint && pnpm check:static` 确认没有
残留引用。

## 4. 扩展成真实业务时改什么

| 要做的事 | 改哪里 |
| --- | --- |
| 换实体/字段 | `schemas/notes.ts` → `tables/notes.ts` → `drizzle-kit generate` → 仓储与 handler |
| 加方法 | `meta.ts` 加通道 → `domains/notes.ts` 绑 schema → handler 实现（编译期强制） |
| 换 UI | `routes/notes.tsx` + `components/notes/*`；保留 `use-notes.ts` 的 query 键与失效 |
| 换深链语义 | `use-deep-link.ts` + 路由声明；主进程只负责投递 `targetId` |
| 去掉文件导入导出 | 删除 handler 两个方法、meta 两行、domain 绑定与 UI 按钮 |

删除示例不会删除 `invalidation` 域本身：它是底座设施，其他业务仍会使用。
