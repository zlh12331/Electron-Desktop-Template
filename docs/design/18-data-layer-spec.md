# 18 · 数据层规范（SQLite + Drizzle）

> 基于模板当前数据栈：better-sqlite3 + Drizzle ORM，`userData` 动态路径。
> 模板只保留一张通用表 `app_settings`；接入业务表时按本文流程扩展。
> 最后同步：2026-10-22（模板版：按当前 schema / db.ts 重写）

---

## 一、技术基线

| 项 | 现状 | 约束 |
|---|---|---|
| 引擎 | better-sqlite3（同步原生） | 不引入第二套数据库；迁移由 drizzle-kit 派生 |
| ORM | Drizzle ORM | `src/main/infra/storage/schema.ts` 是唯一真源 |
| 文件 | `userData/<executableName>.db`（dev 重定向到 `.electron-user-data/`） | 禁止硬编码路径（统一经 `getDbPath()` / `app-data.ts`） |
| 关闭 | `closeDb()` 在服务容器 `dispose()` 末尾执行 | 数据库必须晚于依赖它的服务关闭 |
| 权限 | unix `0600`；win32 ACL 收紧 | 与 `keychain.dat` 同一策略（`restrictFileAccessWin32`） |

## 二、Schema 与迁移

1. **单一真源**：表定义在 `src/main/infra/storage/tables/`，由 `schema.ts` 聚合导出（新增表必须登记进 `schema` 对象）。
2. **表设计约定**：
   - `app_settings`：`key TEXT PRIMARY KEY` / `value TEXT`（JSON）/ `updatedAt INTEGER`；
   - 新表：主键 `id`（TEXT UUID 或 INTEGER autoincrement，按语义）；时间戳统一整数 ms；外键显式声明；高频查询列建索引。
3. **变更流程**：
   1. `tables/<domain>.ts` 定义表 → `schema.ts` 的 `schema` 对象登记；
   2. `pnpm exec drizzle-kit generate` 生成迁移 + journal + snapshot；
   3. 提交 `drizzle/`（入仓，打下包进 `resources/drizzle`）；
   4. 启动时 `migrate()` 自动应用；`check:schema-drift` 拦 schema.ts ↔ 快照漂移。
4. **当前迁移链**：只有一条基线 `0000_fat_absorbing_man.sql`（建 `app_settings`）。旧产品库的迁移记录早于该基线，`db.ts` 的 `rebaseLegacyMigrationBaseline()` 会把新基线登记为已应用，避免重复建表——改动基线时不要删除这段兼容逻辑。
5. **SQLite 限制**：给已有表加 CHECK / UNIQUE 不能 `ALTER TABLE`，需要重建式迁移或触发器兜底；被外键引用的表只能用触发器方式。

## 三、访问分层

```
IPC handler → storage/ 下的存取模块（settings-pref / settings-io / backup-store）→ getDb()
```

- **允许**：存取模块与未来业务 Service 通过 `getDb()` 动态获取连接（不持有实例，便于测试重置与 dispose 顺序）。
- **禁止**：渲染层永不触达数据库（只经 IPC）；IPC handler 不写 SQL，业务查询下沉到存取模块 / Service。
- **参数化**：一律用 Drizzle 绑定参数，禁止字符串拼接 SQL。
- **错误**：数据库异常包装为 `AppError`（code + statusCode），不外泄 SQL 细节。

## 四、设置存取（模板唯一表）

`settings-pref.ts`：

- `readAllSettings()`：全表读取并 JSON 反序列化；损坏条目静默剔除（不炸启动快照）。
- `readSetting(key)` / `writeSetting(key, value)` / `deleteSetting(key)`：单键操作。
- `writeSettings(entries)` / `deleteSettings(keys)`：**事务包裹**，部分失败整体回滚。
- 约束：key 必须匹配 `/^[A-Za-z][A-Za-z0-9._-]{0,63}$/`；单值序列化后 ≤256KB（设置表不承载大对象）。

`settings-io.ts`：设置导出 / 导入（版本化 JSON，白名单键 + 逐键值级 schema；非法值整批拒绝，导入走同一事务写路径）。
`backup-store.ts`：备份列表、健康检查、创建、`stageRestore`（暂存 + 重启生效，避免在 WAL 连接打开时热替换主库）。

## 五、事务边界

判据：**同一业务动作包含 >1 条 DML，且失败回滚优于半写** → 必须 `db.transaction`。

- 已有事务：`writeSettings`、`deleteSettings`（批量设置写入 / 重置）。
- 单语句 DML（天然原子，无需事务）：单键 upsert / 单键删除 / 读取。
- 跨存储组合写（SQLite + keychain + 文件）无法用数据库事务覆盖：按「数据库先行 → 其余为可重建投影」设计，任何一步中断在重启后收敛，不做分布式补偿。

## 六、生命周期与自愈（`db.ts`）

```
applyPendingRestore（上次未完成的恢复）
→ 打开 + 默认 pragma（WAL / foreign_keys / busy_timeout）
→ restoreCorruptDatabase：quick_check 失败则回滚最近健康备份，再失败则归档重建
→ auto_vacuum 对齐（增量回收）
→ 旧基线迁移重挂
→ migrate()
→ 调度启动备份（异步、串行化）
```

- 备份保留 3 份轮转（`BACKUP_KEEP`）；启动备份异步执行，不阻塞窗口。
- 手动备份（`backup:create`）会先排干挂起备份再执行，防并发。
- 恢复（`backup:restore`）为「暂存 + 重启生效」，不热替换打开的库。

## 七、检查清单

- [ ] 新表：`tables/` 定义 + `schema.ts` 登记 + drizzle-kit 迁移 + 测试
- [ ] 新查询：参数化，必要时 `EXPLAIN QUERY PLAN` 验证索引
- [ ] 多语句写：`db.transaction` 包裹
- [ ] 渲染层无数据库访问；handler 不写 SQL
- [ ] 设置 key / 值大小遵守 `settings-pref.ts` 约束
- [ ] `pnpm check:schema-drift` 通过
