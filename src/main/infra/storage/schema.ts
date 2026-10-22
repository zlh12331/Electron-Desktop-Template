// schema.ts：全库唯一真源的聚合入口——表定义在 tables/ 下，本文件只负责汇总与再导出
// 模板版只含通用表（app_settings）；接入业务表时新建 tables/<domain>.ts 并在下方登记。
// 迁移 DDL 由 drizzle-kit 从本文件派生（drizzle.config.ts 的 schema 路径不变）。

import { appSettings } from './tables/core';

// 行类型透传（上层模块从这里导入，勿重复定义）
export * from './tables/core';

// 聚合导出：drizzle() 初始化与 migrate 使用的 schema 对象（新增表必须登记进来）
export const schema = {
  appSettings,
};
