// rate-limit.ts：固定窗口速率限制（渲染层错误上报的防风暴闸门）
// 边界：只做内存计数，不依赖 Electron / 日志；窗口切换时清零，时钟回拨按新窗口处理

/** 固定窗口限流器（线程内单实例；主进程 IPC handler 共享） */
export class FixedWindowRateLimiter {
  private windowStart: number;
  private count = 0;

  /**
   * @param limit 每个窗口允许的次数（>0）
   * @param windowMs 窗口长度（毫秒，>0）
   * @param now 初始窗口起点（测试注入）
   */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    now = Date.now(),
  ) {
    this.windowStart = now;
  }

  /**
   * 尝试获取一个配额
   *
   * @param now 当前时间（测试注入）
   * @returns true = 放行；false = 超过窗口上限
   */
  tryAcquire(now = Date.now()): boolean {
    if (now - this.windowStart >= this.windowMs || now < this.windowStart) {
      this.windowStart = now;
      this.count = 0;
    }
    if (this.count >= this.limit) {
      return false;
    }
    this.count += 1;
    return true;
  }
}
