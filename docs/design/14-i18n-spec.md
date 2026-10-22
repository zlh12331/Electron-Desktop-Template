# 14 · i18n 国际化规范

> 基于当前实现：i18next + react-i18next，`zh-CN`（默认 / fallback）与 `en` 双语，两个命名空间 `common` / `errors`。
> 最后同步：2026-10-22（模板版：修正工具现状与 key 统计口径）

---
> 🔒 工程化强制：`pnpm check:i18n --strict`（缺失 / 冗余 / 双语不一致卡关，已接入 `check:static`）

## 一、文件结构

```
src/renderer/i18n/
├── config.ts              # i18next 初始化（资源、fallback、语言检测）
├── I18nProvider.tsx       # 根 Provider
├── index.ts               # 出口
├── use-translation.ts     # useTranslation 重导出 + useErrorMessage
└── locales/
    ├── en/{common,errors}.json
    └── zh-CN/{common,errors}.json
```

- 语言包是**扁平 JSON**（无 `translation` 顶层包装），一个命名空间一个文件；结构与 `config.ts` 的静态 import 一一对应。
- `en` 与 `zh-CN` 的 key 集合必须完全一致。
- `errors.json` 按 `AppError.code` 存错误文案；`useErrorMessage` 查询失败时回退 `ERROR_META[code].userMessage`。

## 二、key 命名

```
格式：<域>.<组件|场景>.<语义>
示例：
  settings.language
  settings.notificationDesc
  welcome.card.ipc.title
  shortcutHelp.item.openCommandPalette
  errors.BACKUP_RESTORE_FAILED
```

1. **域前缀**与语言包顶层键对齐：`common` / `topbar` / `sidebar` / `settings` / `palette` / `shortcutHelp` / `update` / `welcome` / `home` / `about`（`errors` 单独命名空间）。
2. **语义后缀**：名词（title / desc / label）、状态（running / ready）、动作（open / toggle）。
3. **禁止**：动态值拼进 key、中文 / 拼音 key、编号 key；复数与变量用插值 `{{name}}` / `count`。
4. 技术标识不翻译：错误码、快捷键键位、路径、命令。

## 三、新增文案流程

1. 组件里先写 `t('域.语义')`；
2. 同时在 `zh-CN/common.json` 与 `en/common.json` 加 key（结构一致）；错误码文案进 `errors.json`；
3. 运行 `pnpm check:i18n`——双向校验「代码引用 vs 语言包」并检查双语一致与硬编码中文；
4. 不可翻译内容（品牌名、版本号、代码/命令）直接硬编码，但会被 `i18n:lint` 列为候选，需人工确认。

## 四、验证与工具

- **门禁**：`check:i18n`（自研正则审计，覆盖静态 `t('...')` 引用；动态 key 不做存在性校验，新增动态 key 需登记说明）。
- **开发辅助**：`pnpm i18n:status`（命名空间翻译进度，基于 `i18next.config.ts` 的 locale / 命名空间对齐）、`pnpm i18n:lint`（硬编码文案启发式审计）。两者只读，**不写语言包、不接门禁**。
- **类型提示**：`useTranslation` 直接重导出 react-i18next，模板未启用 key 字面量类型推导；key 拼写正确性由 `check:i18n` 兜底。
- **运行时**：语言存 SQLite（`settings.language`），启动时同步到 localStorage 供 detector 读取；切换语言立即生效。
- **抽查**：切到 `en` 后不应出现 `xxx.yyy` 形式的原文泄漏。

## 五、检查清单

- [ ] key 命名合规（域.场景.语义），未使用中文 / 编号
- [ ] `zh-CN` 与 `en` 同步添加，`check:i18n` 通过
- [ ] 动态内容用插值，不拼接 key
- [ ] 错误文案走 `errors.json`（按 code）
- [ ] 新增动态 key 已在实现处注释说明来源
