# 数据所有权与缓存失效规范（Data Ownership & Invalidation）

> 回答一个问题：**每类数据的真源在哪、谁写、渲染层谁缓存、谁负责失效。**
> 失效中枢是 `use-invalidation-bridge`（AppShell 经 `useAppBridges()` 挂载）——本文件是
> 其实现的规范级视图；两者不一致时以代码为准并回改本文。
>
> 最后同步：2026-10-21（模板版：仅保留通用底座数据）

---

## 一、判据（四层状态架构）

| 层 | 用途 | 落点 |
|---|---|---|
| L1 useState | 组件内瞬态（输入框/折叠/编辑态） | 组件 |
| L2 Zustand | 客户端共享：persistent/（跨重启）/ transient/（会话内） | `stores/` |
| L3 TanStack Query | IPC invoke（请求-响应）：缓存/竞态/重试 | `hooks/` 域文件 + 导出的 queryKey 常量 |
| L4 IPC 事件流 | 主进程持续推送 → subscribe 直接写 transient store | `use-*-bridge` |

判定：IPC invoke → L3；IPC on（持续推送）→ L2 transient；UI 交互态 → L2 transient；组件独享 → L1。

## 二、SQLite 持久数据（真源 = 主进程库表）

模板只有一张表 `app_settings`；接入业务表后按同一张表登记。

| 数据 | 真源 | 写入方（主进程） | 渲染层消费 | 渲染层缓存 | 失效点 |
|---|---|---|---|---|---|
| 应用设置 | `app_settings` 表 | `settings:set` 写穿透 | settings-store 内存镜像 | L2（内存态，非持久插件） | 启动快照 `settings:getAll` 拉取；`settings:event:changed` 广播回写 |

**事务边界**：主进程多语句写的判据见 [18-data-layer-spec.md §四](18-data-layer-spec.md)。

## 三、凭据（真源 = 主进程 keychain.dat）

| 数据 | 真源 | 写入方 | 渲染层消费 | 缓存 | 失效点 |
|---|---|---|---|---|---|
| 凭据 | `userData/keychain.dat`（safeStorage 加密） | `secrets:set` / `secrets:delete` | 设置页「凭据」分区（**只见掩码**） | L3：键名列表 + 单条掩码 | mutation 后失效对应 key |

**安全边界**：明文只在主进程内流通（业务代码直接 `import { getSecret }`），渲染层无任何取明文的通道。

## 四、文件系统数据（真源 = 磁盘，非本应用持有）

| 数据 | 真源 | 谁改 | 渲染层缓存 | 失效点 |
|---|---|---|---|---|
| 日志文件 | `userData/logs/main.log` | electron-log | L3（`logs:read`，按行数/级别分 key） | 手动刷新 |
| 数据库备份 | `userData/backups/` | 启动备份 + `backup:create` | L3（`backup:list`） | create/restore mutation 后 invalidate |

渲染层对这类数据**只有缓存，没有所有权**——永远以 IPC 重查为准，不做本地合并。

## 五、L4 推送 → L2 transient store

| Store | 数据来源（推送） | 生命周期 |
|---|---|---|
| update-store | `update:event:status` | 应用生命周期 |
| ui-store | 纯 UI 交互态（设置/命令面板/快捷键帮助开合） | 用户操作 |
| confirm-dialog-store | 命令式 `confirm()` 调用 | 对话框关闭即清 |

接入流式业务时在此追加：每新增一个 `use-*-bridge` 订阅，登记「来源事件 → 落哪个 store → 何时清理」。

## 六、纯 UI 态（localStorage，非数据真源）

| 用途 | 内容 | 说明 |
|---|---|---|
| 语言 detector 缓存 | `STORAGE_PREFIX:lang` | 仅为 i18next detector 提供同步读取；真源是 SQLite，启动时由快照回填 |
| legacy 设置迁移 | `SETTINGS_STORAGE_KEY` | 首启一次性迁移到 SQLite，迁移后清理 |

设置类（theme / language / shortcuts / update / window / notification / proxy / appearance）**不在** localStorage：
真源 = `app_settings` 表。侧栏 / 右面板折叠态只存在于 `ui-store`（transient），不跨重启。

## 七、失效中枢（use-invalidation-bridge）职责清单

主进程写路径声明受影响域 → `invalidation:event:domains` 广播 → 渲染层按域前缀失效 L3 缓存：

1. **域词表单一真源**：`INVALIDATION_DOMAINS`（`packages/shared/src/schemas/invalidation.ts`），主进程声明侧与渲染层映射侧同源，禁散写字面量；当前为 `settings` / `backups` / `update`
2. **前缀推导**：`lib/invalidation/invalidation.ts` 把域串按 `:` 切成 queryKey 前缀（`settings` → `['settings']`，`entity:abc` → `['entity','abc']`），非法形态跳过
3. **新增域时三处同步**：`INVALIDATION_DOMAINS` 加词 + 主进程写路径调用广播 + 本节登记——缺一即出现「写后看到旧数据」的静默失效
