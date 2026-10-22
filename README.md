# Electron 桌面端模板

Electron 44 + React 19 + TypeScript + Vite 8 的生产级桌面应用模板（Windows / macOS / Linux）。
底座能力开箱可用，业务页面待接入。

## 包含什么

- **类型安全的 IPC 契约体系**：定义表驱动，新增一个方法只改三处，preload API / 通道常量 / 类型全部自动生成，handler 缺失在编译期报错
- **SQLite 设置持久化**：drizzle ORM + 迁移链 + 启动备份与损坏自愈；渲染层写穿透 + 启动快照
- **四层状态架构**：useState / Zustand / TanStack Query / IPC 事件流，判定标准明确
- **三平台打包与自动更新**：electron-builder + electron-updater，CI/CD 与发版流程已接线
- **凭据存储**：safeStorage 加密落盘（DPAPI / Keychain / libsecret），渲染层只见掩码
- **质量门禁**：类型、lint、16 项静态审计、单测、集成测试、E2E、死代码检测、密钥扫描
- **品牌单一真源**：`app.config.json` 一处改产品名 / appId / 协议 / 存储前缀

## 快速开始

```bash
pnpm install
pnpm dev          # Electron 窗口
pnpm dev:web      # 浏览器模式（mock api）
```

## 从模板开始你的项目

一条命令改完全部品牌位点（真源 + package.json + 构建配置 + LICENSE + CODEOWNERS + 文档 URL + i18n 文案 + CHANGELOG）：

```bash
pnpm init:template --name "My App" --app-id com.me.myapp --protocol myapp \
  --owner me --repo myapp --author "Me" --dry-run   # 先看会改哪些文件
pnpm init:template --name "My App" --app-id com.me.myapp --protocol myapp \
  --owner me --repo myapp --author "Me"             # 实际执行
pnpm check:brand                                    # 校验全部位点对齐
```

命令幂等：重复执行同一组参数不会产生额外改动。之后：

1. 替换 `src/renderer/routes/home.tsx` 为你的首屏
2. 按需接入业务：新增 IPC 域、数据表、设置分区、页面，方法见 AGENTS.md「扩展点速查」

只改个别字段也可以手改 `app.config.json` → `pnpm brand:sync` → `pnpm check:brand`。

## 目录

```
src/main/       主进程（组合根 + 服务容器 + IPC handler）
src/preload/    桥接（CJS / sandbox）
src/renderer/   React 渲染层
packages/shared IPC 契约 / zod schema / 常量
docs/           文档：design 规范 / guides 操作 / history 实施记录
```

完整说明见 [AGENTS.md](AGENTS.md)（面向 AI 协作者与新人）与 [docs/README.md](docs/README.md)（文档导航）。

## 许可证

Apache License 2.0（见 [LICENSE](LICENSE)）
