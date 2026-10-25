import { KeyRound, Plus, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useDeleteSecret,
  useSecretKeys,
  useSecretMasked,
  useSecretsAvailability,
  useSetSecret,
} from '@/hooks/use-secrets';
import { useTranslation } from '@/i18n/use-translation';
import { confirm } from '@/stores/transient/confirm-dialog-store';

import { SectionTitle, SettingRow } from '../settings-controls';

/** 单条已存凭据行：键名 + 掩码 + 删除 */
function SecretRow({ secretKey }: { readonly secretKey: string }): ReactElement {
  const { t } = useTranslation();
  const { data } = useSecretMasked(secretKey);
  const deleteMutation = useDeleteSecret();

  const handleDelete = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('settings.secretsDeleteTitle'),
      message: t('settings.secretsDeleteMessage', { key: secretKey }),
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    deleteMutation.mutate(secretKey);
  };

  return (
    <SettingRow label={secretKey} description={data?.masked ?? t('settings.secretsUnreadable')}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('settings.secretsDelete', { key: secretKey })}
        title={t('settings.secretsDelete', { key: secretKey })}
        disabled={deleteMutation.isPending}
        onClick={() => void handleDelete()}
      >
        <Trash2 className="size-3.5" strokeWidth={1.5} />
      </Button>
    </SettingRow>
  );
}

/** 新增凭据表单：键名 + 值 + 保存 */
function SecretForm(): ReactElement {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const setMutation = useSetSecret();

  const canSubmit = key.trim().length > 0 && value.length > 0 && !setMutation.isPending;

  const handleSubmit = (): void => {
    setMutation.mutate(
      { key: key.trim(), value },
      {
        onSuccess: () => {
          setKey('');
          setValue('');
        },
      },
    );
  };

  return (
    <div className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-col gap-1.5">
        <label className="text-foreground text-sm" htmlFor="secret-key-input">
          {t('settings.secretsKeyLabel')}
        </label>
        <Input
          id="secret-key-input"
          className="font-mono text-xs"
          placeholder={t('settings.secretsKeyPlaceholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-foreground text-sm" htmlFor="secret-value-input">
          {t('settings.secretsValueLabel')}
        </label>
        <Input
          id="secret-value-input"
          type="password"
          className="font-mono text-xs"
          placeholder={t('settings.secretsValuePlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              handleSubmit();
            }
          }}
        />
      </div>
      <div>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          <Plus className="size-3.5" strokeWidth={1.5} />
          {t('settings.secretsSave')}
        </Button>
      </div>
    </div>
  );
}

/**
 * 凭据存储区块
 *
 * 安全边界：渲染层只能看到掩码，明文始终留在主进程（详见 packages/shared/src/schemas/secrets.ts）。
 * safeStorage 不可用（Linux 缺 libsecret）时隐藏写入口并给出平台相关指引。
 */
export function SecretsSection(): ReactElement {
  const { t } = useTranslation();
  const availability = useSecretsAvailability();
  const keysQuery = useSecretKeys();

  const available = availability.data?.available ?? false;
  const keys = keysQuery.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <KeyRound className="text-muted-foreground size-3.5" strokeWidth={1.5} />
        <h3 className="text-foreground text-sm font-semibold">{t('settings.secretsTitle')}</h3>
      </div>
      <p className="text-muted-foreground text-xs leading-[1.5]">{t('settings.secretsHint')}</p>

      {!available && (
        <p className="text-destructive text-xs leading-[1.5]">
          {availability.data?.reason === 'insecure-backend'
            ? t('settings.secretsInsecureBackend')
            : t('settings.secretsUnavailable')}
        </p>
      )}

      {available && (
        <>
          <SectionTitle>{t('settings.secretsAddTitle')}</SectionTitle>
          <SecretForm />
        </>
      )}

      <SectionTitle>{t('settings.secretsStoredTitle')}</SectionTitle>
      {keys.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('settings.secretsEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {keys.map((secretKey) => (
            <SecretRow key={secretKey} secretKey={secretKey} />
          ))}
        </div>
      )}
    </div>
  );
}
