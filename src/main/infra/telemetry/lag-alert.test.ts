import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportMessage: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../utils/error-report', () => ({
  reportMessage: mocks.reportMessage,
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

import { reportEventLoopLag } from './lag-alert';

describe('reportEventLoopLag', () => {
  it('上报阻塞时长与堆占用，并写结构化 warn', () => {
    reportEventLoopLag({ lagMs: 1234.6, intervalMs: 1000, exceeded: true, at: Date.now() });

    expect(mocks.reportMessage).toHaveBeenCalledWith(
      expect.stringMatching(/事件循环阻塞：1235ms/),
      'warning',
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ lagMs: 1234.6, intervalMs: 1000 }),
      '主进程事件循环阻塞',
    );
  });
});
