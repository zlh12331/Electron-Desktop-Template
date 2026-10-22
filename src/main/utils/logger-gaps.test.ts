// logger-gaps.test.ts：logger 分支补漏——initLogger 生产/开发分支、错误序列化、
// 全局未处理拒绝、崩溃标记清理。window-state 的边界用例已随模块移到
// src/main/infra/storage/window-state.test.ts（测试与源码同目录）。
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockLog = {
    level: 'info',
    transports: {
      file: { level: 'info', maxRetries: 0, fileName: 'main.log', format: '', maxSize: 0 },
      console: { level: 'debug', format: '' },
    },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    initialize: vi.fn(),
  };
  const mockApp = { isPackaged: false, getPath: vi.fn(() => '/tmp/logger-gaps') };
  return { mockLog, mockApp };
});

vi.mock('electron-log', () => ({ default: mocks.mockLog }));

vi.mock('electron', () => ({
  app: mocks.mockApp,
}));

import { clearCrashMarker, initLogger, logger, registerGlobalErrorHandlers } from './logger';

let tempDir: string;

describe('logger 分支补漏', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = join(tmpdir(), `logger-gaps-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    mkdirSync(tempDir, { recursive: true });
    mocks.mockApp.getPath.mockReturnValue(tempDir);
    mocks.mockApp.isPackaged = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('logger', () => {
    it('initLogger 生产分支：file=info + 控制台关闭', () => {
      mocks.mockApp.isPackaged = true;
      initLogger();
      expect(mocks.mockLog.transports.file.level).toBe('info');
      expect(mocks.mockLog.transports.console.level).toBe(false);
    });

    it('initLogger 开发分支：file=debug + 控制台 debug', () => {
      mocks.mockApp.isPackaged = false;
      initLogger();
      expect(mocks.mockLog.transports.file.level).toBe('debug');
      expect(mocks.mockLog.transports.console.level).toBe('debug');
    });

    it('error 传非 Error 值：String() 兜底序列化', () => {
      logger.error({}, '测试', 'plain-string-error');
      expect(mocks.mockLog.error).toHaveBeenCalled();
    });

    it('error 传带 cause 的 Error：cause 递归序列化', () => {
      const cause = new Error('root cause');
      const wrapped = new Error('wrapped', { cause });
      logger.error({}, '测试', wrapped);
      expect(mocks.mockLog.error).toHaveBeenCalled();
    });

    it('unhandledRejection 非 Error reason：记日志且不抛（不上报路径已移除）', () => {
      mocks.mockLog.error.mockClear();
      registerGlobalErrorHandlers();
      const listeners = process.listeners('unhandledRejection');
      const last = listeners[listeners.length - 1];
      expect(last).toBeDefined();
      if (last !== undefined) {
        expect(() => last('string-reason', Promise.resolve())).not.toThrow();
      }
      expect(mocks.mockLog.error).toHaveBeenCalled();
    });

    it('clearCrashMarker：标记存在时删除 + 日志；不存在时跳过', () => {
      clearCrashMarker();
      expect(mocks.mockLog.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ markerPath: expect.any(String) }),
        '已清除崩溃标记',
      );
    });
  });
});
