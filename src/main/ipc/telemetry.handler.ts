// telemetry.handler.ts：telemetry 域 IPC——渲染层错误转发 + Web Vitals 入库
// 边界：主进程只做级别判定、限流与转发；Sentry/OTel 未配置时静默 no-op（返回稳定结构）
import { EXECUTABLE_NAME, type InferHandlers, type IPC_DEFINITIONS } from '@code-agent/shared/main';
import {
  parseSentryDsn,
  resolveOtelConfig,
  resolveSentryConfig,
} from '@code-agent/shared/observability';
import { app } from 'electron';

import { readTelemetryLevelSync } from '../infra/storage/telemetry-pref';
import { probeOtlpEndpoints } from '../infra/telemetry/connectivity';
import { getOtelActiveConfig, getTelemetryRuntimeStatus } from '../infra/telemetry/otel';
import { emitOtelLog } from '../infra/telemetry/otel-log';
import { recordWebVital } from '../infra/telemetry/otel-metrics';
import { FixedWindowRateLimiter } from '../infra/telemetry/rate-limit';
import { captureRendererError, getSentryStatus } from '../infra/telemetry/sentry';
import { getTelemetryHealth } from '../infra/telemetry/telemetry-health';
import type { IpcHandlerContext } from './wrap';

// 渲染层错误风暴（错误边界循环 / 定时器抛错）时，每分钟最多转发 30 条；
// 超出部分本地日志仍由 electron-log 落盘，不会丢证据
const ERROR_LIMIT_PER_MINUTE = 30;

const errorLimiter = new FixedWindowRateLimiter(ERROR_LIMIT_PER_MINUTE, 60_000);

// 连接测试会发起真实网络请求：每分钟最多 5 次，防误触/连点
const connectionLimiter = new FixedWindowRateLimiter(5, 60_000);

/** telemetry 域 handler（错误转发 + Web Vitals；所有分支都返回稳定响应） */
export const telemetryHandlers: InferHandlers<
  typeof IPC_DEFINITIONS,
  IpcHandlerContext
>['telemetry'] = {
  captureError: async (input, ctx) => {
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
      {
        ...(input.tags ?? {}),
        traceId: ctx.traceId,
        processType: 'renderer',
        scope: 'renderer.error',
      },
      '渲染层错误上报',
      rendererError,
    );
    captureRendererError(input, ctx.traceId);
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

  getStatus: async () => {
    const otel = getTelemetryRuntimeStatus();
    const sentry = getSentryStatus();
    return {
      level: otel.level,
      sentry: {
        enabled: sentry.enabled,
        initialized: sentry.initialized,
        reason: sentry.reason,
        release: sentry.release,
        environment: sentry.environment,
      },
      otel: {
        enabled: otel.enabled,
        tracing: otel.tracing,
        metrics: otel.metrics,
        logs: otel.logs,
        endpointConfigured: otel.endpointConfigured,
      },
      health: getTelemetryHealth(),
    };
  },

  testConnection: async () => {
    const level = getTelemetryRuntimeStatus().level;
    const sentry = resolveSentryConfig(process.env, {
      level,
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      executableName: EXECUTABLE_NAME,
    });
    const dsnInfo = parseSentryDsn(sentry.dsn);
    const sentryConfigured = sentry.dsn !== '';
    const sentryValid = level !== 'off' && sentryConfigured && dsnInfo.valid;
    const sentryMessage =
      level === 'off'
        ? '遥测级别 off，Sentry 未启用'
        : !sentryConfigured
          ? '未配置 DSN'
          : dsnInfo.valid
            ? '配置有效（未发送测试事件）'
            : dsnInfo.message;

    if (!connectionLimiter.tryAcquire()) {
      return {
        sentry: {
          configured: sentryConfigured,
          valid: sentryValid,
          message: sentryMessage,
        },
        otlp: {
          checked: false,
          reason: 'rate-limited',
          message: '请求过于频繁，请稍后再试',
          results: [],
        },
      };
    }

    if (level === 'off') {
      return {
        sentry: { configured: sentryConfigured, valid: false, message: sentryMessage },
        otlp: {
          checked: false,
          reason: 'off',
          message: '遥测级别 off，未探测 OTLP',
          results: [],
        },
      };
    }

    const otel =
      getOtelActiveConfig() ??
      resolveOtelConfig(process.env, {
        isPackaged: app.isPackaged,
        level,
        executableName: EXECUTABLE_NAME,
      });
    const results = await probeOtlpEndpoints(otel);
    const reachable = results.filter((result) => result.ok).length;
    return {
      sentry: {
        configured: sentryConfigured,
        valid: sentryValid,
        message: sentryMessage,
      },
      otlp: {
        checked: results.length > 0,
        reason: results.length > 0 ? 'probed' : 'no-endpoint',
        message:
          results.length === 0 ? '未配置 OTLP 端点' : `${reachable}/${results.length} 个端点可达`,
        results,
      },
    };
  },
};
