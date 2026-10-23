// telemetry.handler.ts：telemetry 域 IPC——渲染层错误转发 + Web Vitals 入库
// 边界：主进程只做级别判定、限流与转发；Sentry/OTel 未配置时静默 no-op（返回稳定结构）
import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';

import { readTelemetryLevelSync } from '../infra/storage/telemetry-pref';
import { emitOtelLog } from '../infra/telemetry/otel-log';
import { recordWebVital } from '../infra/telemetry/otel-metrics';
import { FixedWindowRateLimiter } from '../infra/telemetry/rate-limit';
import { captureRendererError } from '../infra/telemetry/sentry';
import type { IpcHandlerContext } from './wrap';

// 渲染层错误风暴（错误边界循环 / 定时器抛错）时，每分钟最多转发 30 条；
// 超出部分本地日志仍由 electron-log 落盘，不会丢证据
const ERROR_LIMIT_PER_MINUTE = 30;

const errorLimiter = new FixedWindowRateLimiter(ERROR_LIMIT_PER_MINUTE, 60_000);

/** telemetry 域 handler（错误转发 + Web Vitals；所有分支都返回稳定响应） */
export const telemetryHandlers: InferHandlers<
  typeof IPC_DEFINITIONS,
  IpcHandlerContext
>['telemetry'] = {
  captureError: async (input) => {
    if (readTelemetryLevelSync() === 'off') {
      return { accepted: false };
    }
    if (!errorLimiter.tryAcquire()) {
      return { accepted: false };
    }
    const rendererError = new Error(input.message);
    if (input.name !== undefined) {
      rendererError.name = input.name;
    }
    if (input.stack !== undefined) {
      rendererError.stack = input.stack;
    }
    emitOtelLog(
      'error',
      { ...(input.tags ?? {}), processType: 'renderer', scope: 'renderer.error' },
      '渲染层错误上报',
      rendererError,
    );
    captureRendererError(input);
    return { accepted: true };
  },

  reportWebVitals: async (input) => {
    let accepted = 0;
    for (const metric of input.metrics) {
      if (
        recordWebVital(metric.name, metric.value, {
          ...(metric.rating !== undefined ? { rating: metric.rating } : {}),
          ...(metric.navigationType !== undefined ? { navigationType: metric.navigationType } : {}),
        })
      ) {
        accepted += 1;
      }
    }
    return { accepted };
  },
};
