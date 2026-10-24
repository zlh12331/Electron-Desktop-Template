import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  log: {
    transports: { file: { getFile: vi.fn() }, console: {} },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  app: { exit: vi.fn(), getPath: vi.fn(() => '/synthetic/userdata'), isPackaged: false },
  writeFile: vi.fn(),
}));
vi.mock('electron-log', () => ({ default: mocks.log }));
vi.mock('electron', () => ({ app: mocks.app }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: mocks.writeFile,
}));

let loggerModule: typeof import('./logger');
let registry: typeof import('./telemetry-flush');
let handleFatal: (error: Error) => void;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.app.getPath.mockReturnValue('/synthetic/userdata');
  loggerModule = await import('./logger');
  registry = await import('./telemetry-flush');
  const on = vi.spyOn(process, 'on').mockImplementation(() => process);
  loggerModule.registerGlobalErrorHandlers();
  handleFatal = on.mock.calls.find(([name]) => name === 'uncaughtException')?.[1] as (
    error: Error,
  ) => void;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fatal 日志与遥测共同退出预算', () => {
  it('先安装硬退出，再写 marker；本地队列和两个 SDK 都等待', async () => {
    const file = { asyncWriteQueue: ['pending'], hasActiveAsyncWriting: true };
    mocks.log.transports.file.getFile.mockReturnValue(file);
    mocks.log.error.mockImplementation(() => {
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });
    const sentry = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    const otel = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));
    registry.registerTelemetryFlush('sentry', sentry);
    registry.registerTelemetryFlush('otel', otel);
    handleFatal(new Error('synthetic fatal'));
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(sentry).toHaveBeenCalledWith(1_500);
    expect(otel).toHaveBeenCalledWith(1_500);
    await vi.advanceTimersByTimeAsync(399);
    expect(mocks.app.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.app.exit).toHaveBeenCalledWith(1);
    handleFatal(new Error('duplicate'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.app.exit).toHaveBeenCalledTimes(1);
  });

  it('没有遥测时只等本地排空，最多 300ms', async () => {
    mocks.log.transports.file.getFile.mockReturnValue({
      asyncWriteQueue: ['pending'],
      hasActiveAsyncWriting: true,
    });
    handleFatal(new Error('synthetic fatal'));
    await vi.advanceTimersByTimeAsync(299);
    expect(mocks.app.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.app.exit).toHaveBeenCalledWith(1);
  });

  it('SDK 永不完成、marker getter 和文件队列失败也会按总预算退出', async () => {
    registry.registerTelemetryFlush('otel', () => new Promise(() => {}));
    registry.registerTelemetryFlush('sentry', () => {
      throw new Error('sdk');
    });
    mocks.log.transports.file.getFile.mockImplementation(() => {
      throw new Error('transport');
    });
    const error = new Error('synthetic');
    Object.defineProperty(error, 'message', {
      get: () => {
        throw new Error('getter');
      },
    });
    expect(() => handleFatal(error)).not.toThrow();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mocks.app.exit).toHaveBeenCalledWith(1);
  });
});
