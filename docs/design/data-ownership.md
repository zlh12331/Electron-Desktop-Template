# 数据所有权与缓存失效规范（Data Ownership & Invalidation）

> 回答一个问题：**每类数据的真源在哪、谁写、渲染层谁缓存、谁负责失效。**
> 失效中枢是 `use-invalidation-bridge`（AppShell 经 `useAppBridges()` 挂载）——本文件是
> 其实现的规范级视图；两者不一致时以代码为准并回改本文。
>
> 最后同步：2026-10-27（模板版：通用底座 + Local Notes 参考切片）

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

模板保留两张表：通用 `app_settings`，以及随示例可整体删除的 `notes`；派生项目接入业务表后按同一张表登记。

| 数据 | 真源 | 写入方（主进程） | 渲染层消费 | 渲染层缓存 | 失效点 |
|---|---|---|---|---|---|
| 应用设置 | `app_settings` 表 | `settings:set` 写穿透 | settings-store 内存镜像 | L2（内存态，非持久插件） | 启动快照 `settings:getAll` 拉取；主进程主动变更（托盘/导入/代理）经 `settings:event:changed` 回写，渲染层自身写路径不广播以避免回声 |
| 笔记 | `notes` 表 | `notes:create/update/delete/importFile` | Notes 列表/详情 + 编辑器草稿 | L3：列表/详情；编辑器为 L1 草稿 | mutation 本地失效 + handler 广播 `notes` 域（带 entityId） |

**事务边界**：主进程多语句写的判据见 [18-data-layer-spec.md §四](18-data-layer-spec.md)。

## 三、凭据（真源 = 主进程 keychain.dat）

| 数据 | 真源 | 写入方 | 渲染层消费 | 缓存 | 失效点 |
|---|---|---|---|---|---|
| 凭据 | `userData/keychain.dat`（safeStorage 加密） | `secrets:set` / `secrets:delete` | 设置页「凭据」分区（**只见掩码**） | L3：键名列表 + 单条掩码 | mutation 后失效对应 key |

**安全边界**：明文只在主进程内流通（业务代码直接 `import { getSecret }`），渲染层无任何取明文的通道。

## 四、文件系统数据（真源 = 磁盘，非本应用持有）

| 数据 | 真源 | 谁改 | 渲染层缓存 | 失效点 |
|---|---|---|---|---|
| 日志文件 | 平台日志目录 `main.log`（Win/Linux `userData/logs`，macOS `~/Library/Logs/<appName>`） | electron-log | L3（`logs:read`，按行数/级别分 key） | 手动刷新 |
| 数据库备份 | `userData/backups/` | 启动备份 + `backup:create` | L3（`backup:list`） | create/restore mutation 后 invalidate |

渲染层对这类数据**只有缓存，没有所有权**——永远以 IPC 重查为准，不做本地合并。

## 五、L4 推送 → L2 transient store

| Store / 桥 | 数据来源（推送） | 生命周期 |
|---|---|---|
| update-store | `update:event:status` | 应用生命周期 |
| settings-store 镜像 | `settings:event:changed` | 应用生命周期 |
| ui-store | 纯 UI 交互态（设置/命令面板/快捷键帮助开合） | 用户操作 |
| confirm-dialog-store | 命令式 `confirm()` 调用 | 对话框关闭即清 |
| use-invalidation-bridge | `invalidation:event:domains` | App 生命周期；不写 store，直接失效 L3 |

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

1. **域词表单一真源**：`INVALIDATION_DOMAINS`（`packages/shared/src/schemas/invalidation.ts`），主进程声明侧与渲染层映射侧同源，禁散写字面量；当前词表为 `settings` / `backups` / `update` / `notes`
2. **当前实际生产者**：只有 Notes 写路径调用 `broadcastInvalidation`；`settings` / `update` 走各自专用事件，`backups` 由 mutation 本地失效。词表里存在不等于已接线，新写路径必须显式补生产者。
3. **前缀推导**：`lib/invalidation/invalidation.ts` 把域串按 `:` 切成 queryKey 前缀（`settings` → `['settings']`，`entity:abc` → `['entity','abc']`），非法形态跳过
4. **新增域时三处同步**：`INVALIDATION_DOMAINS` 加词 + 主进程写路径调用广播 + 本节登记——缺一即出现「写后看到旧数据」的静默失效

## 八、卸载清理边界（Windows NSIS）

真源 = `resources/installer.nsh` 的 `customUnInstall`；本表是行为契约，改清理项须同步本节。

| 路径 / 对象 | 手动卸载 | 更新 / 覆盖安装 | 说明 |
|---|---|---|---|
| updater cache `%LOCALAPPDATA%\<package name>-updater` | 删除 | 保留 | 更新包本身就在其中，更新期删除会破坏升级 |
| userData `%APPDATA%\<package name>`（设置 / 笔记 / 备份 / 日志 / 凭据） | 弹窗询问，默认保留；`--delete-app-data` 直接删 | 保留 | 交互式默认按钮为「否」；静默卸载无 flag 时保留 |
| 开机自启 Run 值 | 删除 | 保留 | 值名随 AppUserModelID 漂移（默认 `electron.app.<exe ProductName>`，快捷方式启动为 appId），按命令行 exe 路径前缀匹配；更新期删除会静默关闭用户自启 |
| 协议 `HKCU\Software\Classes\<protocol>` | 删除 | 旧卸载器删除、新安装器重注册 | 与安装器注册对称，避免残留指向已删 exe |
| `%TEMP%\ns*.tmp` / `electron-download-*` | 不删 | 不删 | 非本应用所有：NSIS / 其他安装器 / 开发期 `@electron/get` 产物；通配删除会误伤 |
| `%LOCALAPPDATA%\electron` / `electron-builder` | 不删 | 不删 | 共享工具缓存，不属于本应用 |

判断「更新模式」的依据是旧卸载器命令行里的 `/KEEP_APP_DATA`（electron-builder `installUtil.nsh` 固定传入）；不要改成基于时间、文件存在性或 `--updated` 的启发式。旧卸载器失败兜底（`customUnInstallCheck`）只清 `$INSTDIR`，同样不碰 userData / updater cache。

静默卸载：`Uninstall <product>.exe /S` 保留用户数据；`Uninstall <product>.exe /S --delete-app-data` 删除用户数据。App 运行时没有自有临时目录（诊断包写到用户选择的位置），因此卸载器无需、也不应清理系统临时目录。
