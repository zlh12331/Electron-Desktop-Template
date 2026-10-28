import type { ProxyProtocol } from '@code-agent/shared/renderer';
import { Network } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/use-translation';

import { SegControl, SettingRow } from '../settings-controls';
import { useProxyDraft } from './proxy-section-draft';
import {
  ProxyAuthFields,
  ProxyBypassField,
  ProxyServerFields,
  ProxyTestField,
  SystemProxyCard,
} from './proxy-section-fields';
import { useProxySectionMutations } from './proxy-section-mutations';

/** 网络代理分区（系统 / 直连 / 自定义 HTTP·HTTPS·SOCKS5） */
export function ProxySection(): ReactElement {
  const { t } = useTranslation();
  const draft = useProxyDraft();
  const mutations = useProxySectionMutations({
    proxy: draft.proxy,
    mode: draft.mode,
    updateProxy: draft.updateProxy,
    setMode: draft.setMode,
    setProtocol: draft.setProtocol,
    setHost: draft.setHost,
    setPortText: draft.setPortText,
    setAuthEnabled: draft.setAuthEnabled,
    setUsername: draft.setUsername,
    setPassword: draft.setPassword,
    setTouched: draft.setTouched,
    setTestResult: draft.setTestResult,
    testTarget: draft.testTarget,
    buildDraftConfig: draft.buildDraftConfig,
    persistLatest: draft.persistLatest,
  });

  const handleModeChange = (value: string): void => {
    const next = value as 'system' | 'direct' | 'fixed';
    draft.setMode(next);
    draft.setTestResult(null);
    if (next !== 'fixed') {
      draft.cancelSave();
      draft.updateProxy({ mode: next });
      return;
    }
    if (draft.hostValid && draft.portValid) {
      draft.persistLatest();
    }
  };

  const handleProtocolChange = (value: string): void => {
    const next = value as ProxyProtocol;
    draft.setProtocol(next);
    draft.setPassword('');
    draft.setTestResult(null);
    if (next === 'socks5' && draft.authEnabled) {
      draft.setAuthEnabled(false);
      draft.setUsername('');
      if (draft.proxy.hasAuth === true) {
        mutations.clearAuthMutation.mutate();
      }
    }
    draft.scheduleSave();
  };

  const handleHostChange = (value: string): void => {
    draft.setHost(value);
    draft.setPassword('');
    draft.setTouched(true);
    draft.setTestResult(null);
    draft.scheduleSave();
  };

  const handlePortChange = (value: string): void => {
    draft.setPortText(value);
    draft.setPassword('');
    draft.setTouched(true);
    draft.setTestResult(null);
    draft.scheduleSave();
  };

  const handleBypassChange = (value: string): void => {
    draft.setBypassText(value);
    draft.setTestResult(null);
    draft.scheduleSave();
  };

  const handleAuthToggle = (checked: boolean): void => {
    draft.setAuthEnabled(checked);
    draft.setTestResult(null);
    if (!checked) {
      draft.setUsername('');
      draft.setPassword('');
      draft.setShowPassword(false);
      if (draft.proxy.hasAuth === true) {
        mutations.clearAuthMutation.mutate();
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network className="text-muted-foreground size-3.5" strokeWidth={1.5} />
          <h3 className="text-foreground text-sm font-semibold">{t('settings.proxyTitle')}</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={mutations.importMutation.isPending}
          onClick={() => mutations.importMutation.mutate()}
        >
          {t('settings.proxyImportFromSystem')}
        </Button>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <SettingRow
          label={t('settings.proxyModeLabel')}
          description={t('settings.proxyModeDesc')}
          className="flex-col items-stretch gap-2 sm:flex-row sm:items-center"
        >
          <SegControl
            value={draft.mode}
            options={[
              { value: 'system', label: t('settings.proxyModeSystem') },
              { value: 'direct', label: t('settings.proxyModeDirect') },
              { value: 'fixed', label: t('settings.proxyModeFixed') },
            ]}
            onChange={handleModeChange}
          />
        </SettingRow>

        {draft.mode === 'system' && (
          <SystemProxyCard
            result={mutations.systemProxyQuery.data}
            fetching={mutations.systemProxyQuery.isFetching}
            onRefresh={() => void mutations.systemProxyQuery.refetch()}
          />
        )}

        {draft.mode === 'fixed' && (
          <>
            <ProxyServerFields
              {...draft}
              onProtocolChange={handleProtocolChange}
              onHostChange={handleHostChange}
              onPortChange={handlePortChange}
              onBlur={() => draft.setTouched(true)}
            />
            <ProxyAuthFields
              enabled={draft.authEnabled}
              unsupported={draft.authUnsupported}
              incomplete={draft.authIncomplete}
              username={draft.username}
              password={draft.password}
              showPassword={draft.showPassword}
              hasAuth={draft.proxy.hasAuth === true}
              savedUsername={draft.proxy.authUsername ?? null}
              clearPending={mutations.clearAuthMutation.isPending}
              onToggle={handleAuthToggle}
              onUsernameChange={(value) => {
                draft.setUsername(value);
                draft.setTestResult(null);
              }}
              onPasswordChange={(value) => {
                draft.setPassword(value);
                draft.setTestResult(null);
              }}
              onToggleShow={() => draft.setShowPassword(!draft.showPassword)}
              onClear={() => mutations.clearAuthMutation.mutate()}
              onBlur={draft.persistLatest}
            />
            <ProxyBypassField
              value={draft.bypassText}
              onChange={handleBypassChange}
              onBlur={draft.persistLatest}
            />
            <ProxyTestField
              target={draft.testTarget}
              result={draft.testResult}
              canTest={draft.canTest}
              pending={mutations.testMutation.isPending}
              onTargetChange={(value) => {
                draft.setTestTarget(value);
                draft.setTestResult(null);
              }}
              onTest={mutations.runTest}
            />
          </>
        )}
      </div>
    </div>
  );
}
