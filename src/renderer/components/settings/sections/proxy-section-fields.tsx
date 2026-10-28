import type {
  ProxyDetectSystemRes,
  ProxyProtocol,
  ProxyTestRes,
} from '@code-agent/shared/renderer';
import type { TFunction } from 'i18next';
import { Eye, EyeOff } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n/use-translation';

const PROTOCOLS = [
  { value: 'http', labelKey: 'settings.proxyProtocolHttp' },
  { value: 'https', labelKey: 'settings.proxyProtocolHttps' },
  { value: 'socks5', labelKey: 'settings.proxyProtocolSocks5' },
] as const;

/** 测试结果的展示态（不含 message，渲染层只按 kind 映射文案） */
export interface ProxyTestResultState {
  readonly ok: boolean;
  readonly kind: ProxyTestRes['kind'];
  readonly latencyMs?: number;
}

/** 服务器卡 props */
export interface ProxyServerFieldsProps {
  readonly protocol: ProxyProtocol;
  readonly host: string;
  readonly portText: string;
  readonly touched: boolean;
  readonly hostValid: boolean;
  readonly portValid: boolean;
  readonly onProtocolChange: (value: string) => void;
  readonly onHostChange: (value: string) => void;
  readonly onPortChange: (value: string) => void;
  readonly onBlur: () => void;
}

/** 代理服务器卡：协议 + 主机 + 端口 + 行内校验 */
export function ProxyServerFields({
  protocol,
  host,
  portText,
  touched,
  hostValid,
  portValid,
  onProtocolChange,
  onHostChange,
  onPortChange,
  onBlur,
}: ProxyServerFieldsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="bg-card rounded-lg border px-3 py-2.5">
      <Label className="text-foreground text-sm">{t('settings.proxyServerLabel')}</Label>
      <div className="mt-1.5 flex flex-wrap items-start gap-2">
        <Select value={protocol} onValueChange={onProtocolChange}>
          <SelectTrigger
            className="w-[112px]"
            size="sm"
            aria-label={t('settings.proxyProtocolLabel')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROTOCOLS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {t(item.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-[160px] flex-1">
          <Input
            aria-label={t('settings.proxyHostLabel')}
            placeholder={t('settings.proxyHostPlaceholder')}
            value={host}
            onChange={(event) => onHostChange(event.target.value)}
            onBlur={onBlur}
          />
          {touched && !hostValid && (
            <p className="text-destructive mt-1 text-xs">
              {host.trim() === ''
                ? t('settings.proxyHostRequired')
                : t('settings.proxyHostInvalid')}
            </p>
          )}
        </div>
        <div className="relative w-[96px] shrink-0">
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs">
            :
          </span>
          <Input
            aria-label={t('settings.proxyPortLabel')}
            className="pl-4"
            type="number"
            min={1}
            max={65535}
            placeholder={t('settings.proxyPortPlaceholder')}
            value={portText}
            onChange={(event) => onPortChange(event.target.value)}
            onBlur={onBlur}
          />
          {touched && !portValid && (
            <p className="text-destructive mt-1 text-xs">{t('settings.proxyPortInvalid')}</p>
          )}
        </div>
      </div>
      <p className="text-muted-foreground mt-1 text-xs leading-[1.5]">
        {t('settings.proxyServerDesc')}
      </p>
    </div>
  );
}

/** 认证卡 props */
export interface ProxyAuthFieldsProps {
  readonly enabled: boolean;
  readonly unsupported: boolean;
  readonly incomplete: boolean;
  readonly username: string;
  readonly password: string;
  readonly showPassword: boolean;
  readonly hasAuth: boolean;
  readonly savedUsername: string | null;
  readonly clearPending: boolean;
  readonly onToggle: (checked: boolean) => void;
  readonly onUsernameChange: (value: string) => void;
  readonly onPasswordChange: (value: string) => void;
  readonly onToggleShow: () => void;
  readonly onClear: () => void;
  readonly onBlur: () => void;
}

/** 代理认证卡：开关 + 用户名/密码（密码可显示）+ 已保存状态 */
export function ProxyAuthFields({
  enabled,
  unsupported,
  incomplete,
  username,
  password,
  showPassword,
  hasAuth,
  savedUsername,
  clearPending,
  onToggle,
  onUsernameChange,
  onPasswordChange,
  onToggleShow,
  onClear,
  onBlur,
}: ProxyAuthFieldsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="bg-card rounded-lg border px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm">{t('settings.proxyAuthLabel')}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-[1.5]">
            {unsupported ? t('settings.proxyAuthSocks5Unsupported') : t('settings.proxyAuthDesc')}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={unsupported}
          aria-label={t('settings.proxyAuthLabel')}
        />
      </div>
      {enabled && !unsupported && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2">
          <Input
            aria-label={t('settings.proxyAuthUsername')}
            placeholder={t('settings.proxyAuthUsername')}
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            onBlur={onBlur}
          />
          <div className="relative">
            <Input
              aria-label={t('settings.proxyAuthPassword')}
              placeholder={t('settings.proxyAuthPassword')}
              type={showPassword ? 'text' : 'password'}
              value={password}
              className="pr-9"
              onChange={(event) => onPasswordChange(event.target.value)}
              onBlur={onBlur}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-0 right-0 h-full px-2"
              aria-label={showPassword ? t('settings.proxyAuthHide') : t('settings.proxyAuthShow')}
              onClick={onToggleShow}
            >
              {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
        </div>
      )}
      {incomplete && (
        <p className="text-muted-foreground mt-1 text-xs">{t('settings.proxyAuthRequired')}</p>
      )}
      {hasAuth && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <p className="text-muted-foreground text-xs leading-[1.5]">
            {t('settings.proxyAuthSaved', { username: savedUsername ?? '-' })}
          </p>
          <Button variant="ghost" size="sm" disabled={clearPending} onClick={onClear}>
            {t('settings.proxyAuthClear')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 绕过列表卡 props */
export interface ProxyBypassFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
}

/** 绕过列表卡（多行，一行一条） */
export function ProxyBypassField({ value, onChange, onBlur }: ProxyBypassFieldProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="bg-card rounded-lg border px-3 py-2.5">
      <Label className="text-foreground text-sm" htmlFor="proxy-bypass-input">
        {t('settings.proxyBypassLabel')}
      </Label>
      <Textarea
        id="proxy-bypass-input"
        className="mt-1.5 min-h-[72px] font-mono text-xs"
        placeholder={t('settings.proxyBypassPlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <p className="text-muted-foreground mt-1 text-xs leading-[1.5]">
        {t('settings.proxyBypassDesc')}
      </p>
    </div>
  );
}

/** 连通性测试卡 props */
export interface ProxyTestFieldProps {
  readonly target: string;
  readonly result: ProxyTestResultState | null;
  readonly canTest: boolean;
  readonly pending: boolean;
  readonly onTargetChange: (value: string) => void;
  readonly onTest: () => void;
}

/** 连通性测试卡：目标 + 测试按钮 + 归因/耗时 */
export function ProxyTestField({
  target,
  result,
  canTest,
  pending,
  onTargetChange,
  onTest,
}: ProxyTestFieldProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="bg-card rounded-lg border px-3 py-2.5">
      <Label className="text-foreground text-sm" htmlFor="proxy-test-target-input">
        {t('settings.proxyTestTargetLabel')}
      </Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Input
          id="proxy-test-target-input"
          className="min-w-[180px] flex-1 font-mono text-xs"
          placeholder={t('settings.proxyTestTargetPlaceholder')}
          value={target}
          onChange={(event) => onTargetChange(event.target.value)}
        />
        <Button variant="outline" size="sm" disabled={!canTest || pending} onClick={onTest}>
          {t('settings.proxyTestButton')}
        </Button>
      </div>
      <p className="text-muted-foreground mt-1 text-xs leading-[1.5]">
        {t('settings.proxyTestTargetDesc')}
      </p>
      {result !== null && (
        <p className={result.ok ? 'text-foreground mt-1 text-xs' : 'text-destructive mt-1 text-xs'}>
          {formatTestResult(t, result)}
        </p>
      )}
    </div>
  );
}

function formatTestResult(t: TFunction, result: ProxyTestResultState): string {
  if (result.ok) {
    return t('settings.proxyTestSuccess', { ms: result.latencyMs ?? 0 });
  }
  switch (result.kind) {
    case 'proxy-unreachable':
      return t('settings.proxyTestProxyUnreachable');
    case 'auth-failed':
      return t('settings.proxyTestAuthFailed');
    case 'timeout':
      return t('settings.proxyTestTimeout');
    case 'not-applicable':
      return t('settings.proxyTestNotApplicable');
    default:
      return t('settings.proxyTestTargetUnreachable');
  }
}

/** 系统代理卡 props */
export interface SystemProxyCardProps {
  readonly result: ProxyDetectSystemRes | undefined;
  readonly fetching: boolean;
  readonly onRefresh: () => void;
}

/** 跟随系统模式：当前系统代理 + 刷新 */
export function SystemProxyCard({
  result,
  fetching,
  onRefresh,
}: SystemProxyCardProps): ReactElement {
  const { t } = useTranslation();
  const text =
    result?.detected === true &&
    result.protocol !== undefined &&
    result.host !== undefined &&
    result.port !== undefined
      ? `${result.protocol}://${result.host}:${result.port}`
      : t('settings.proxySystemNotDetected');
  return (
    <div className="bg-card flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-foreground text-sm">{t('settings.proxySystemCurrent')}</p>
        <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
          {fetching ? t('settings.proxySystemDetecting') : text}
        </p>
      </div>
      <Button variant="ghost" size="sm" disabled={fetching} onClick={onRefresh}>
        {t('settings.proxySystemRefresh')}
      </Button>
    </div>
  );
}
