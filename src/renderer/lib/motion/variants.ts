import type { Variants } from 'motion/react';

import { easeIn, easeOut, microTransition, smoothEaseOut } from './transitions';

/**
 * 淡入淡出变体（最常用）
 *
 * 适合：消息出现、tooltip、loading 占位、状态切换
 */
export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: smoothEaseOut,
  },
  exit: {
    opacity: 0,
    transition: microTransition,
  },
};

/**
 * 从下方滑入变体
 *
 * 适合：消息气泡、下拉菜单内容、列表新增项
 */
export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.25,
      ease: easeOut,
    },
  },
  exit: {
    opacity: 0,
    y: 4,
    transition: {
      duration: 0.2,
      ease: easeIn,
    },
  },
};
