// settings-sections.ts：设置分区的 id 与默认值（叶子常量，零依赖）
// 为什么单独成文件：分区 id 被 ui-store（transient 状态）与设置注册表（含 React 组件）
// 同时引用。放在 store 里会让注册表反向依赖 store；放在注册表里会让 store 依赖组件层。
// 叶子模块让两边都只依赖常量本身。
// 新增分区：本文件加一个 id → sections/registry.tsx 加一条注册项，两处即可。
// 模板版只含通用分区（通用 / 外观 / 通知 / 数据 / 快捷键 / 网络代理 / Beta / 关于）；
// 接入业务后按需追加业务分区 id。

/** 全部分区 id（顺序即导航顺序） */
const SETTINGS_SECTION_IDS = [
  'general',
  'appearance',
  'notification',
  'data',
  'shortcuts',
  'proxy',
  'beta',
  'about',
] as const;

/** 设置分区 id 联合类型 */
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/** 默认分区（未指定直达分区时的落地页） */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general';
