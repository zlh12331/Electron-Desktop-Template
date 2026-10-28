import type { ProxyProtocol, ProxyTestReq } from '@code-agent/shared/renderer';
import { useEffect, useRef, useState } from 'react';

import { useLatestRef } from '@/hooks/use-latest-ref';
import { useSettingsStore } from '@/stores/persistent/settings-store';

import type { ProxyTestResultState } from './proxy-section-fields';

type ProxySettings = ReturnType<typeof useSettingsStore.getState>['proxy'];
type UpdateProxy = ReturnType<typeof useSettingsStore.getState>['updateProxy'];
type ProxyMode = ProxySettings['mode'];

/** 代理表单草稿：本地输入态 + 防抖写穿透（store 只在合法时更新） */
export interface ProxyDraft {
  readonly proxy: ProxySettings;
  readonly updateProxy: UpdateProxy;
  readonly mode: ProxyMode;
  readonly setMode: (mode: ProxyMode) => void;
  readonly protocol: ProxyProtocol;
  readonly setProtocol: (protocol: ProxyProtocol) => void;
  readonly host: string;
  readonly setHost: (host: string) => void;
  readonly portText: string;
  readonly setPortText: (port: string) => void;
  readonly bypassText: string;
  readonly setBypassText: (bypass: string) => void;
  readonly authEnabled: boolean;
  readonly setAuthEnabled: (enabled: boolean) => void;
  readonly username: string;
  readonly setUsername: (username: string) => void;
  readonly password: string;
  readonly setPassword: (password: string) => void;
  readonly showPassword: boolean;
  readonly setShowPassword: (show: boolean) => void;
  readonly touched: boolean;
  readonly setTouched: (touched: boolean) => void;
  readonly testTarget: string;
  readonly setTestTarget: (target: string) => void;
  readonly testResult: ProxyTestResultState | null;
  readonly setTestResult: (result: ProxyTestResultState | null) => void;
  readonly hostValid: boolean;
  readonly portValid: boolean;
  readonly canTest: boolean;
  readonly authUnsupported: boolean;
  readonly authIncomplete: boolean;
  readonly buildDraftConfig: () => NonNullable<ProxyTestReq['config']>;
  readonly persistLatest: () => void;
  readonly scheduleSave: () => void;
  readonly cancelSave: () => void;
}

function parseBypass(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].slice(0, 64);
}

function isValidHost(host: string): boolean {
  return host !== '' && !/[\s/?#@[\]]/.test(host);
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** 代理表单状态与持久化（固定代理草稿；system/direct 不走这里） */
export function useProxyDraft(): ProxyDraft {
  const proxy = useSettingsStore((state) => state.proxy);
  const updateProxy = useSettingsStore((state) => state.updateProxy);

  const [mode, setModeState] = useState<ProxyMode>(proxy.mode);
  const [protocol, setProtocolState] = useState<ProxyProtocol>(proxy.protocol ?? 'http');
  const [host, setHost] = useState(proxy.host ?? '');
  const [portText, setPortText] = useState(proxy.port === undefined ? '' : String(proxy.port));
  const [bypassText, setBypassText] = useState((proxy.bypass ?? []).join('\n'));
  const [authEnabled, setAuthEnabled] = useState(proxy.hasAuth === true);
  const [username, setUsername] = useState(proxy.authUsername ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [testTarget, setTestTarget] = useState('');
  const [testResult, setTestResult] = useState<ProxyTestResultState | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const draftRef = useLatestRef({
    protocol,
    host,
    portText,
    bypassText,
    authEnabled,
    username,
    password,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    setAuthEnabled(proxy.hasAuth === true);
    setUsername(proxy.authUsername ?? '');
    if (proxy.hasAuth !== true) {
      setPassword('');
      setShowPassword(false);
    }
  }, [proxy.hasAuth, proxy.authUsername]);

  const port = Number(portText);
  const hostValid = isValidHost(host.trim());
  const portValid = portText.trim() !== '' && isValidPort(port);
  const canTest = mode === 'fixed' && hostValid && portValid;
  const authUnsupported = protocol === 'socks5';
  const authIncomplete =
    authEnabled && !authUnsupported && password === '' && proxy.hasAuth !== true;

  const buildDraftConfig = (): NonNullable<ProxyTestReq['config']> => {
    const draft = draftRef.current;
    return {
      mode: 'fixed',
      protocol: draft.protocol,
      host: draft.host.trim(),
      port: Number(draft.portText),
      bypass: parseBypass(draft.bypassText),
      ...(draft.authEnabled && draft.protocol !== 'socks5' && draft.password !== ''
        ? { auth: { username: draft.username.trim(), password: draft.password } }
        : {}),
    };
  };

  const persistLatest = (): void => {
    const draft = draftRef.current;
    const draftHost = draft.host.trim();
    const draftPort = Number(draft.portText);
    if (!isValidHost(draftHost) || !isValidPort(draftPort)) {
      return;
    }
    const auth =
      draft.authEnabled && draft.protocol !== 'socks5' && draft.password !== ''
        ? { username: draft.username.trim(), password: draft.password }
        : undefined;
    updateProxy({
      mode: 'fixed',
      protocol: draft.protocol,
      host: draftHost,
      port: draftPort,
      bypass: parseBypass(draft.bypassText),
      ...(auth !== undefined ? { auth } : {}),
    });
  };

  const scheduleSave = (): void => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      if (mounted.current) {
        persistLatest();
      }
    }, 500);
  };

  const cancelSave = (): void => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  };

  return {
    proxy,
    updateProxy,
    mode,
    setMode: setModeState,
    protocol,
    setProtocol: setProtocolState,
    host,
    setHost,
    portText,
    setPortText,
    bypassText,
    setBypassText,
    authEnabled,
    setAuthEnabled,
    username,
    setUsername,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    touched,
    setTouched,
    testTarget,
    setTestTarget,
    testResult,
    setTestResult,
    hostValid,
    portValid,
    canTest,
    authUnsupported,
    authIncomplete,
    buildDraftConfig,
    persistLatest,
    scheduleSave,
    cancelSave,
  };
}
