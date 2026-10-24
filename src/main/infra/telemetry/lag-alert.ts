// lag-alert.ts：事件循环阻塞告警的文案与上报（reportMessage + warn 双落）
import { reportMessage } from '../../utils/error-report';
import { logger } from '../../utils/logger';
import type { EventLoopLagSample } from './event-loop-lag';

/**
 * 上报一次阻塞采样：附堆占用，便于区分系统级卡顿与应用内计算
 */
export function reportEventLoopLag(sample: EventLoopLagSample): void {
  const context = {
    lagMs: sample.lagMs,
    intervalMs: sample.intervalMs,
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
  };
  reportMessage(
    `主进程事件循环阻塞：${sample.lagMs.toFixed(0)}ms（堆=${context.heapUsedMb}MB）`,
    'warning',
  );
  logger.warn(context, '主进程事件循环阻塞');
}
