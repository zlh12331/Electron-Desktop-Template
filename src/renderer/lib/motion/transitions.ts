import type { Transition } from 'motion/react';

/**
 * 标准缓出（最常用）
 *
 * 对应 styles/ 各域 css 的 --ease-soft: cubic-bezier(0.4, 0, 0.2, 1)
 * 适合：消息出现、列表项淡入、按钮反馈
 */
export const easeOut: [number, number, number, number] = [0.4, 0, 0.2, 1];

/**
 * 纸张缓动（更柔和）
 *
 * 对应 styles/ 各域 css 的 --ease-paper: cubic-bezier(0.25, 0.46, 0.45, 0.94)
 * 适合：面板展开、抽屉滑入、内容切换
 */
export const easePaper: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

/**
 * 缓入（用于 exit 动画）
 *
 * 配合 easeOut 形成自然的进入-退出节奏
 */
export const easeIn: [number, number, number, number] = [0.4, 0, 1, 1];

/**
 * 微交互过渡（按钮点击、图标反馈）
 *
 * 时长 150ms + easeOut，给人「即时响应」感
 */
export const microTransition: Transition = {
  duration: 0.15,
  ease: easeOut,
};

/**
 * 平滑淡入过渡（消息出现、列表项淡入）
 *
 * 时长 200ms + easeOut，适合大多数 UI 元素的出现
 */
export const smoothEaseOut: Transition = {
  duration: 0.2,
  ease: easeOut,
};
