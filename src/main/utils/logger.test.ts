import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLog } = vi.hoisted(() => {
  const mockLog = {
    level: 'info',
    transports: {
      file: { level: 'info', maxRetries: 0, fileName: 'main.log' },
      console: { level: 'debug' },
    },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    initialize: vi.fn(),
  };
  return { mockLog };
});

vi.mock('electron-log', () => ({ default: mockLog }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp/test-userdata') },
}));

import {
  flushPendingLogs,
  initLogger,
  logger,
  registerGlobalErrorHandlers,
  setLogSink,
} from './logger';

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLogSink(null);
  });

  it('暴露 info/warn/error/debug 方法', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('info 日志携带 traceId 字段', () => {
    initLogger();
    logger.info({ traceId: 'test-trace-123', channel: 'project:create' }, 'IPC 请求开始');
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'test-trace-123',
        channel: 'project:create',
        message: 'IPC 请求开始',
      }),
    );
  });

  it('error 日志支持 Error 对象', () => {
    const err = new Error('测试错误');
    logger.error({ traceId: 't1' }, '操作失败', err);
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('循环 cause 和最大深度不会无限递归', () => {
    const error = new Error('cycle');
    error.cause = error;
    logger.error({}, 'cycle', error);
    expect(mockLog.error).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ cause: { value: '[Circular]' } }),
      }),
    );
    let deep = new Error('root');
    for (let i = 0; i < 100; i += 1) {
      deep = new Error('wrapped', { cause: deep });
    }
    logger.error({}, 'deep', deep);
    expect(JSON.stringify(mockLog.error.mock.calls.at(-1))).toContain('[Truncated]');
  });

  it('异常 getter、非 Error 转字符串失败和坏上下文不产生二次异常', () => {
    const error = new Error('synthetic');
    Object.defineProperty(error, 'cause', {
      get: () => {
        throw new Error('bad getter');
      },
    });
    Object.defineProperty(error, 'message', {
      get: () => {
        throw new Error('bad getter');
      },
    });
    expect(() => logger.error({}, 'bad error', error)).not.toThrow();
    expect(() =>
      logger.error({}, 'bad value', {
        toString: () => {
          throw new Error('bad conversion');
        },
      }),
    ).not.toThrow();
    expect(() =>
      logger.error(
        {
          get bad(): never {
            throw new Error('bad context');
          },
        },
        'context',
      ),
    ).not.toThrow();
    expect(mockLog.error).toHaveBeenCalledTimes(3);
  });

  it('sink 抛错不影响所有本地级别，显式 remote 不覆盖本地字段', () => {
    const sink = vi.fn(() => {
      throw new Error('sdk failure');
    });
    setLogSink(sink);
    expect(() => {
      logger.debug({}, 'debug');
      logger.info({}, 'info');
      logger.warn({}, 'warn');
      logger.error({ local: 'detail' }, 'local', undefined, {
        context: { safe: true },
        message: 'remote',
      });
    }).not.toThrow();
    expect(mockLog.error).toHaveBeenCalledWith({ local: 'detail', message: 'local' });
    expect(sink).toHaveBeenLastCalledWith('error', { safe: true }, 'remote');
    expect(mockLog.debug).toHaveBeenCalledTimes(1);
    expect(mockLog.info).toHaveBeenCalledTimes(1);
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    setLogSink(null);
  });

  it('setLogSink：旁路收到级别/上下文/正文/原始错误，注销后不再回调', () => {
    const sink = vi.fn();
    setLogSink(sink);
    logger.info({ traceId: 't1' }, 'hello');
    const error = new Error('boom');
    logger.error({ traceId: 't2' }, 'failed', error);
    expect(sink).toHaveBeenNthCalledWith(1, 'info', { traceId: 't1' }, 'hello');
    expect(sink).toHaveBeenNthCalledWith(2, 'error', { traceId: 't2' }, 'failed', error);
    setLogSink(null);
    logger.warn({}, 'after');
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('registerGlobalErrorHandlers 注册 process 事件', () => {
    const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    registerGlobalErrorHandlers();
    expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    onSpy.mockRestore();
  });

  it('测试环境重定向日志路径（回归锚：曾把测试夹具写进真实用户日志目录）', () => {
    initLogger();
    const fileTransport = mockLog.transports.file as unknown as {
      resolvePathFn?: () => string;
    };
    expect(typeof fileTransport.resolvePathFn).toBe('function');
    const resolved = fileTransport.resolvePathFn?.() ?? '';
    expect(resolved).toContain('code-agent-test-logs');
    expect(resolved).not.toContain('code-agent-desktop');
  });

  it('flushPendingLogs：electron-log 无 getFile（内部结构变化/测试 mock）时立即返回', async () => {
    await expect(flushPendingLogs(50)).resolves.toBeUndefined();
  });

  it('flushPendingLogs：轮询等待队列清空后返回', async () => {
    const fileState = { asyncWriteQueue: ['log line'], hasActiveAsyncWriting: true };
    const fileTransport = mockLog.transports.file as { getFile?: () => unknown };
    fileTransport.getFile = () => {
      fileState.asyncWriteQueue = [];
      fileState.hasActiveAsyncWriting = false;
      return fileState;
    };
    await expect(flushPendingLogs(2_000)).resolves.toBeUndefined();
    delete fileTransport.getFile;
  });
});
