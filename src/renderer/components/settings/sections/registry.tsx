// sections/registry.tsx：设置分区的单一注册表——导航项、图标、组件在此声明
// 为什么是注册表而不是 switch：分区组件与导航项此前分两处维护，新增分区要同步改多个地方，
// 漏一处就静默失效。注册表把导航与组件绑定合一：一条注册项即一个分区。
// 模板化用法：新增分区 = sections/<name>-section.tsx + settings-sections.ts 加 id + 本文件加一行。

import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Database,
  FlaskConical,
  Info,
  Keyboard,
  Network,
  Palette,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

import type { SettingsSectionId } from '@/lib/settings-sections';

import { AboutSection } from './about-section';
import { BetaSection } from './beta-section';
import { DataSection } from './data-section';
import { GeneralSection } from './general-section';
import { NotificationSection } from './notification-section';
import { ProxySection } from './proxy-section';
import { ShortcutsSection } from './shortcuts-section';
import { ZoomSection } from './zoom-section';

/** 分区渲染 props（仅需要抽屉开合态的分区会读它） */
interface SectionRenderProps {
  /** 设置抽屉是否打开（订阅型分区据此暂停轮询等副作用） */
  readonly drawerOpen: boolean;
}

/** 一条分区注册项 */
export interface SettingsSectionEntry {
  /** 分区 id（与 SETTINGS_SECTION_IDS 对齐） */
  readonly id: SettingsSectionId;
  /** 导航文案 i18n key */
  readonly labelKey: string;
  /** 导航图标 */
  readonly icon: LucideIcon;
  /** 分区内容组件 */
  readonly component: (props: SectionRenderProps) => ReactElement;
}

/** 设置分区注册表（模板版：8 个通用分区） */
export const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = [
  {
    id: 'general',
    labelKey: 'settings.nav.general',
    icon: SettingsIcon,
    component: GeneralSection,
  },
  {
    id: 'appearance',
    labelKey: 'settings.nav.appearance',
    icon: Palette,
    component: ZoomSection,
  },
  {
    id: 'notification',
    labelKey: 'settings.nav.notification',
    icon: Bell,
    component: NotificationSection,
  },
  { id: 'data', labelKey: 'settings.nav.data', icon: Database, component: DataSection },
  {
    id: 'shortcuts',
    labelKey: 'settings.nav.shortcuts',
    icon: Keyboard,
    component: ShortcutsSection,
  },
  { id: 'proxy', labelKey: 'settings.nav.proxy', icon: Network, component: ProxySection },
  { id: 'beta', labelKey: 'settings.nav.beta', icon: FlaskConical, component: BetaSection },
  { id: 'about', labelKey: 'settings.nav.about', icon: Info, component: AboutSection },
];

/** 扁平化后的分区表（id → 注册项），供渲染与查找 */
export const SETTINGS_SECTION_MAP: ReadonlyMap<SettingsSectionId, SettingsSectionEntry> = new Map(
  SETTINGS_SECTIONS.map((item) => [item.id, item] as const),
);
