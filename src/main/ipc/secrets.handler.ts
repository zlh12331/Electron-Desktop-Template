// secrets.handler.ts：secrets 域 IPC——凭据增删查掩码（**不含取明文**，见 schemas/secrets.ts 的安全边界）
import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';
import {
  deleteSecret,
  getSecret,
  isEncryptionAvailable,
  listSecrets,
  maskSecret,
  setSecret,
} from '../infra/storage/keychain';
import type { IpcHandlerContext } from '../utils/wrap';

export const secretsHandlers: InferHandlers<typeof IPC_DEFINITIONS, IpcHandlerContext>['secrets'] =
  {
    isAvailable: async () => ({
      available: isEncryptionAvailable(),
      platform: process.platform,
    }),

    list: async () => ({ keys: (await listSecrets()).sort() }),

    set: async (input) => {
      await setSecret(input.key, input.value);
      return { ok: true };
    },

    delete: async (input) => {
      await deleteSecret(input.key);
      return { ok: true };
    },

    getMasked: async (input) => {
      const value = await getSecret(input.key);
      return { masked: value === null ? null : maskSecret(value) };
    },
  };
