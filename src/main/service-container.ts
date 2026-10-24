// service-container.ts：主进程服务容器（组合根）——通用服务按反向依赖装配、
// dispose 善后链（顺序敏感）、崩溃恢复。导出单例 serviceContainer
// 边界：只装配与生命周期管理，业务实现在各自 infra 模块；本文件不写业务逻辑。
// 模板版仅保留通用底座：更新 / 浏览器预览不在此列（模板无预览需求），
// 如需新增业务服务，按「私有字段 + lazy getter + set 注入 + dispose 步骤」四件套追加。
import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater, CancellationToken } = electronUpdater;

// electron-updater 的 CancellationToken 是一次性语义：每次更新检查必须用全新实例，
// 复用已取消的 token 会让后续所有检查被永久取消——故传工厂而非实例
const createUpdateToken = (): InstanceType<typeof CancellationToken> => new CancellationToken();

import { closeDb, resetDb } from './infra/storage/db';
import { type IUpdateService, UpdateService } from './infra/update/update-service';
import { reportError } from './utils/error-report';
import { clearCrashMarker, logger, readCrashMarker } from './utils/logger';

class ServiceContainer {
  // ───── 惰性单例字段：null = 未构造，首次 get* 才实例化；set* 仅供测试注入替换 ─────

  private updateService: IUpdateService | null = null;

  /** 更新服务：electron-updater 实例注入（isPackaged 探针 + token 工厂由这里给定） */
  getUpdateService(): IUpdateService {
    if (this.updateService === null) {
      this.updateService = new UpdateService(autoUpdater, () => app.isPackaged, createUpdateToken);
    }
    return this.updateService;
  }

  /**
   * 退出善后链：单步失败收集到 failures 继续走（createDisposeStep），
   * 确保一个卡死服务不拖垮整条链；DB 永远最后关。
   */
  async dispose(): Promise<void> {
    logger.info({}, '开始清理应用服务');

    const failures: string[] = [];
    const runStep = createDisposeStep(failures);

    await runStep('updateService.dispose', () => {
      this.updateService?.dispose();
      this.updateService = null;
    });

    await runStep('closeDb', async () => {
      await closeDb();
    });

    if (failures.length > 0) {
      logger.error({ failures }, '应用服务清理完成（部分失败）');
    } else {
      logger.info({}, '应用服务清理完成');
    }
  }

  /** 测试用全量重置（含 DB 单例），生产代码不得调用 */
  reset(): void {
    this.updateService = null;
    resetDb();
  }
}

// 释放单例：disposeServices 只做 dispose 不做单例重置——退出路径专属；
// reset() 是测试用全量重置（含 DB 单例），生产代码不得调用
export const serviceContainer = new ServiceContainer();

// dispose 单步包装：失败记名继续，返回收集器供 dispose 汇总日志
function createDisposeStep(
  failures: string[],
): (name: string, fn: () => Promise<void> | void) => Promise<void> {
  return async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      failures.push(name);
      logger.error(
        {
          step: name,
          error: error instanceof Error ? error.message : String(error),
        },
        '服务清理失败（继续后续清理）',
      );
    }
  };
}

/**
 * 崩溃恢复：finally 清崩溃标记；残留状态修复钩子留给业务层注册。
 *
 * 模板版只做标记清理与日志——没有会话/任务表，故无「running 标 interrupted」步骤。
 * 接入业务表后应在 runStep 内补对应恢复动作。
 */
export async function recoverFromCrash(): Promise<void> {
  const marker = readCrashMarker();
  if (marker !== null) {
    const crashedAt = new Date(marker.timestamp).toISOString();
    logger.warn({ crashedAt, message: marker.message }, '检测到上次进程异常退出（崩溃标记）');
    const recovered = new Error(`上次进程异常退出：${marker.message}`);
    if (marker.stack !== undefined) {
      recovered.stack = marker.stack;
    }
    reportError(recovered, {
      tags: { scope: 'crash-recovery', 'crash.previous': 'true', 'crash.timestamp': crashedAt },
    });
  }
  try {
    // 业务恢复钩子占位（模板无业务状态需要修复）
  } finally {
    clearCrashMarker();
  }
}

export async function disposeServices(): Promise<void> {
  await serviceContainer.dispose();
}
