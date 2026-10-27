// update.handler.ts：update 域 IPC——检查/安装/取消下载/状态/缓存信息与清理
import type { InferHandlers, IPC_DEFINITIONS, UpdateCacheInfo } from '@code-agent/shared/main';

import type { IUpdateService } from '../infra/update/update-service';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

/** 缓存读写经 deps 注入（依赖 process.resourcesPath，便于测试替换） */
export interface UpdateHandlerDeps {
  readonly updateService: IUpdateService;
  readonly readCacheInfo: () => Promise<UpdateCacheInfo>;
  readonly clearCache: () => Promise<UpdateCacheInfo>;
}

/** 依赖注入工厂：index.ts 装配（Pick 类型——本域部分方法在定义表中另有归属） */
export function createUpdateHandlers(
  deps: UpdateHandlerDeps,
): Pick<
  InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['update'],
  'check' | 'download' | 'install' | 'cancel' | 'getStatus' | 'getCacheInfo' | 'clearCache'
> {
  return {
    check: async (input) => {
      return deps.updateService.check(input.manual ?? false);
    },
    download: async () => {
      return deps.updateService.download();
    },
    install: async () => {
      deps.updateService.quitAndInstall();
      return { ok: true };
    },
    cancel: async () => {
      deps.updateService.cancelDownload();
      return { ok: true };
    },
    getStatus: async () => {
      return deps.updateService.getStatus();
    },
    getCacheInfo: async () => {
      return deps.readCacheInfo();
    },
    clearCache: async () => {
      const info = await deps.clearCache();
      logger.info({ path: info.path, files: info.fileCount }, '更新缓存已清理');
      return info;
    },
  };
}
