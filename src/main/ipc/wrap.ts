// wrap.ts：IPC handler 统一包装——sender 白名单校验、入参/响应 zod 契约、traceId 贯穿、
// span/metrics 观测、错误归一为 IpcError。定义表体系（ipc/register.ts）对全部 request 通道套用本包装
import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode, type IpcError, type IpcResponse } from '@code-agent/shared/main';
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain, type WebContents } from 'electron';
import type { ZodType } from 'zod';
import { withSpan } from '../infra/telemetry/otel';
import { recordIpcRequest } from '../infra/telemetry/otel-metrics';
import { reportError } from '../utils/error-report';
import { logger } from '../utils/logger';

// 渲染层可自带 traceId 贯穿请求日志，但须过白名单（防任意串进日志）；不合规格则重新生成
const TRACE_ID_PATTERN = /^[\w-]{8,64}$/;

// sender 来源白名单：打包态只认产物 index.html，dev 只认 dev server origin——
// 防其他 webContents（预览/外来 iframe）调用本应用 IPC
function isAllowedSenderUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') {
      return parsed.pathname.endsWith('/renderer/index.html');
    }
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl !== undefined && devUrl.length > 0) {
      return parsed.origin === new URL(devUrl).origin;
    }
    return false;
  } catch {
    return false;
  }
}

/** handler 执行上下文：贯穿日志的 traceId + 发起方 webContents */
export interface IpcHandlerContext {
  readonly traceId: string;
  readonly sender: WebContents;
}

// biome-ignore lint/style/useNamingConvention: TInput 为 TS 泛型惯例
type ParsedInput<TInput> =
  | { readonly ok: true; readonly value: TInput }
  | { readonly ok: false; readonly error: IpcError };

/** sender 校验：不合法时返回归一错误，合法返回 null（保持 handleRequest 扁平） */
function validateSender(
  evt: IpcMainInvokeEvent,
  channel: string,
  traceId: string,
): IpcError | null {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (win !== null && isAllowedSenderUrl(evt.sender.getURL())) {
    return null;
  }
  logger.error({ traceId, channel, senderUrl: evt.sender.getURL() }, 'IPC sender 无效');
  return new AppError(ErrorCode.IPC_SENDER_INVALID).toIpcError();
}

/** 入参校验：schema 为 null 时要求无入参（undefined）；失败返回 INVALID_INPUT */
// biome-ignore lint/style/useNamingConvention: TInput 为 TS 泛型惯例
function parseInput<TInput>(
  schema: ZodType<TInput> | null,
  input: unknown,
  channel: string,
  traceId: string,
): ParsedInput<TInput> {
  if (schema === null) {
    if (input !== undefined) {
      logger.warn({ traceId, channel }, 'IPC 无参方法收到非 undefined 入参');
      return {
        ok: false,
        error: new AppError(ErrorCode.INVALID_INPUT, '该方法不接受入参').toIpcError(),
      };
    }
    return { ok: true, value: undefined as TInput };
  }

  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  logger.warn({ traceId, channel, issues: parsed.error.issues }, 'IPC 参数校验失败');
  return {
    ok: false,
    error: new AppError(ErrorCode.INVALID_INPUT, undefined, parsed.error, {
      issues: parsed.error.issues,
    }).toIpcError(),
  };
}

/** 响应契约校验：schema 缺省时透传；失败返回 INVALID_RESPONSE */
// biome-ignore lint/style/useNamingConvention: TOutput 为 TS 泛型惯例
function parseOutput<TOutput>(
  data: TOutput,
  resSchema: ZodType<TOutput> | undefined,
  channel: string,
  traceId: string,
):
  | { readonly ok: true; readonly value: TOutput }
  | { readonly ok: false; readonly error: IpcError } {
  if (resSchema === undefined) {
    return { ok: true, value: data };
  }
  const parsed = resSchema.safeParse(data);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  reportError(parsed.error, {
    message: 'IPC 响应契约校验失败',
    fields: { traceId, channel, issues: parsed.error.issues },
    tags: { channel, traceId, errorCode: ErrorCode.INVALID_RESPONSE },
  });
  return {
    ok: false,
    error: new AppError(ErrorCode.INVALID_RESPONSE, undefined, parsed.error, {
      issues: parsed.error.issues,
    }).toIpcError(),
  };
}

/**
 * 注册一个被包装的 IPC handler：sender 校验 → 入参 zod 校验（无参方法收到入参即拒）→
 * 执行 → 响应 zod 校验 → { data } / { error }；任何异常归一为 IpcError 并 reportError
 *
 * 全程 traceId 贯穿请求日志（开始/成功/失败同 id 可串联），外层 span + 成功/失败指标
 * 覆盖包括校验失败在内的所有请求；traceId 也写入 span 属性，便于日志与链路互查。
 */
// biome-ignore lint/style/useNamingConvention: TInput/TOutput 为 TS 泛型惯例，描述入参/出参类型
export function wrap<TInput, TOutput>(
  channel: string,
  schema: ZodType<TInput> | null,
  handler: (input: TInput, ctx: IpcHandlerContext) => Promise<TOutput>,
  resSchema?: ZodType<TOutput>,
): void {
  const handleRequest = async (
    evt: IpcMainInvokeEvent,
    input: unknown,
    traceId: string,
  ): Promise<IpcResponse<TOutput>> => {
    const senderError = validateSender(evt, channel, traceId);
    if (senderError !== null) {
      return { error: senderError };
    }

    const parsedInput = parseInput(schema, input, channel, traceId);
    if (!parsedInput.ok) {
      return { error: parsedInput.error };
    }

    const ctx: IpcHandlerContext = { traceId, sender: evt.sender };
    const startTime = performance.now();
    try {
      // 请求明细走 debug（生产 file 级别 info 不落盘）；失败仍由 error 级保留
      logger.debug({ traceId, channel }, 'IPC 请求开始');
      const output = parseOutput(
        await handler(parsedInput.value, ctx),
        resSchema,
        channel,
        traceId,
      );
      if (!output.ok) {
        return { error: output.error };
      }
      const durationMs = Math.round(performance.now() - startTime);
      logger.debug({ traceId, channel, durationMs }, 'IPC 请求成功');
      return { data: output.value };
    } catch (error: unknown) {
      const ipcError = toIpcError(error);
      const durationMs = Math.round(performance.now() - startTime);
      // 单条本地日志 + Sentry 走同一出口，避免「IPC 请求失败」与「错误上报」双写
      reportError(error, {
        message: 'IPC 请求失败',
        fields: { traceId, channel, errorCode: ipcError.code, durationMs },
        tags: { channel, traceId, errorCode: ipcError.code },
      });
      return { error: ipcError };
    }
  };

  ipcMain.handle(channel, async (evt, input: unknown, incomingTraceId?: string) => {
    const traceId =
      typeof incomingTraceId === 'string' && TRACE_ID_PATTERN.test(incomingTraceId)
        ? incomingTraceId
        : randomUUID();
    const startedAt = performance.now();
    let outcome: 'success' | 'error' = 'error';

    try {
      const response = await withSpan(
        `ipc ${channel}`,
        { 'rpc.system': 'electron-ipc', 'rpc.method': channel, 'app.trace_id': traceId },
        async () => handleRequest(evt, input, traceId),
        (result) => ('error' in result ? result.error.code : null),
      );
      outcome = 'error' in response ? 'error' : 'success';
      return response;
    } catch (error: unknown) {
      // handleRequest 内部已归一业务错误；这里兜住包装层/遥测层的意外异常
      const ipcError = toIpcError(error);
      reportError(error, {
        message: 'IPC 包装层异常',
        fields: { traceId, channel, errorCode: ipcError.code },
        tags: { channel, traceId, errorCode: ipcError.code },
      });
      return { error: ipcError };
    } finally {
      recordIpcRequest(channel, outcome, performance.now() - startedAt);
    }
  });
}

// 非 AppError 的裸异常包装成 INTERNAL_ERROR：内部错误细节只进日志，
// 渲染层拿到的是稳定错误码 + 脱敏消息
function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) {
    return error.toIpcError();
  }
  const wrapped = new AppError(ErrorCode.INTERNAL_ERROR, undefined, error);
  return wrapped.toIpcError();
}
