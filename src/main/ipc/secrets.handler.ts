// secrets.handler.ts：secrets 域 IPC——凭据增删查掩码（**不含取明文**，见 schemas/secrets.ts 的安全边界）
import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';
import { AppError, ErrorCode } from '@code-agent/shared/main';
import {
  deleteSecret,
  getEncryptionStatus,
  getSecret,
  isReservedSecretKey,
  listSecrets,
  maskSecret,
  setSecret,
} from '../infra/storage/keychain';
import { logger } from '../utils/logger';
import type { IpcHandlerContext } from './wrap';

function assertVisibleKey(key: string): void {
  if (isReservedSecretKey(key)) {
    throw new AppError(ErrorCode.INVALID_INPUT, '该凭据键为内部保留，不允许通过 secrets 域访问');
  }
}

export const secretsHandlers: InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['secrets'] =
  {
    isAvailable: async () => {
      const status = getEncryptionStatus();
      return { ...status, platform: process.platform };
    },

    list: async () => ({
      keys: (await listSecrets()).filter((key) => !isReservedSecretKey(key)).sort(),
    }),

    set: async (input) => {
      assertVisibleKey(input.key);
      await setSecret(input.key, input.value);
      logger.info({ key: input.key }, '凭据已写入');
      return { ok: true };
    },

    delete: async (input) => {
      assertVisibleKey(input.key);
      await deleteSecret(input.key);
      logger.info({ key: input.key }, '凭据已删除');
      return { ok: true };
    },

    getMasked: async (input) => {
      assertVisibleKey(input.key);
      const value = await getSecret(input.key);
      return { masked: value === null ? null : maskSecret(value) };
    },
  };
