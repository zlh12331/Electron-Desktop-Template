import type { TelemetryStatusRes, TelemetryTestConnectionRes } from '@code-agent/shared/renderer';
import { Activity } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useTelemetryStatusQuery, useTestTelemetryConnection } from '@/hooks/use-telemetry';
import { useTranslation } from '@/i18n/use-translation';
import { formatClockTime } from '@/lib/format-intl';

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function onOff(value: boolean, t: TranslateFn): string {
  return value ? t('settings.obsOn') : t('settings.obsOff');
}

function reasonLabel(reason: TelemetryStatusRes['sentry']['reason'], t: TranslateFn): string {
  switch (reason) {
    case 'telemetry-off':
      return t('settings.obsReasonTelemetryOff');
    case 'no-dsn':
      return t('settings.obsReasonNoDsn');
    case 'init-failed':
      return t('settings.obsReasonInitFailed');
    default:
      return '';
  }
}

function summarizeHealth(health: TelemetryStatusRes['health']): {
  attempts: number;
  failures: number;
  dropped: number;
  lastSuccess: number | null;
} {
  const signals = [health.traces, health.metrics, health.logs];
  const lastSuccessValues = signals
    .map((signal) => signal.lastSuccessAt)
    .filter((value): value is number => value !== null);
  return {
    attempts: signals.reduce((sum, signal) => sum + signal.attempts, 0),
    failures: signals.reduce((sum, signal) => sum + signal.failures, 0),
    dropped: health.sampledLogs + health.rateLimitedLogs,
    lastSuccess: lastSuccessValues.length === 0 ? null : Math.max(...lastSuccessValues),
  };
}

function StatusGrid({ status }: { readonly status: TelemetryStatusRes }): ReactElement {
  const { t } = useTranslation();
  const reason = reasonLabel(status.sentry.reason, t);
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">{t('settings.obsSentry')}</span>
      <span>
        {onOff(status.sentry.enabled, t)}
        {reason !== '' ? ` · ${reason}` : ''}
        {status.sentry.release !== null ? ` · ${status.sentry.release}` : ''}
      </span>
      <span className="text-muted-foreground">{t('settings.obsOtel')}</span>
      <span>{onOff(status.otel.enabled, t)}</span>
      <span className="text-muted-foreground">{t('settings.obsTrace')}</span>
      <span>{onOff(status.otel.tracing, t)}</span>
      <span className="text-muted-foreground">{t('settings.obsMetrics')}</span>
      <span>{onOff(status.otel.metrics, t)}</span>
      <span className="text-muted-foreground">{t('settings.obsLogs')}</span>
      <span>{onOff(status.otel.logs, t)}</span>
      <span className="text-muted-foreground">{t('settings.obsEndpoint')}</span>
      <span>
        {status.otel.endpointConfigured
          ? t('settings.obsEndpointOn')
          : t('settings.obsEndpointOff')}
      </span>
    </div>
  );
}

function ConnectionResult({ data }: { readonly data: TelemetryTestConnectionRes }): ReactElement {
  const { t } = useTranslation();
  const sentryText = data.sentry.valid
    ? t('settings.obsSentryValid')
    : data.sentry.configured
      ? t('settings.obsSentryInvalid')
      : t('settings.obsSentryMissing');
  const skippedText =
    data.otlp.reason === 'off'
      ? t('settings.obsTelemetryOff')
      : data.otlp.reason === 'rate-limited'
        ? t('settings.obsTestRateLimited')
        : t('settings.obsNoEndpoint');

  return (
    <div className="text-2xs text-muted-foreground" role="status" aria-live="polite">
      <p>
        {t('settings.obsTestTitle')} · {t('settings.obsSentry')}: {sentryText}
      </p>
      {data.otlp.checked ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {data.otlp.results.map((result) => (
            <li key={result.signal}>
              {result.signal}: {result.ok ? t('settings.obsReachable') : result.message}
            </li>
          ))}
        </ul>
      ) : (
        <p>{skippedText}</p>
      )}
    </div>
  );
}

/** 设置页可观测性状态卡：Sentry/OTel 启用态势 + 管道健康 + 主动连接测试 */
export function TelemetryStatusCard(): ReactElement {
  const { t, i18n } = useTranslation();
  const { data: status, isLoading } = useTelemetryStatusQuery();
  const test = useTestTelemetryConnection();

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t('settings.obsLoading')}</p>;
  }
  if (status === null || status === undefined) {
    return <p className="text-xs text-muted-foreground">{t('settings.obsNoBridge')}</p>;
  }

  const health = summarizeHealth(status.health);
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <Label className="font-serif text-sm tracking-wide">{t('settings.obsTitle')}</Label>
      </div>
      <StatusGrid status={status} />
      <p className="text-2xs text-muted-foreground">
        {t('settings.obsHealth', {
          attempts: health.attempts,
          failures: health.failures,
          dropped: health.dropped,
        })}
        {' · '}
        {health.lastSuccess === null
          ? t('settings.obsNever')
          : t('settings.obsLastSuccess', {
              time: formatClockTime(health.lastSuccess, i18n.language),
            })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? t('settings.obsTesting') : t('settings.obsTest')}
        </Button>
      </div>
      {test.data !== undefined ? <ConnectionResult data={test.data} /> : null}
    </div>
  );
}
