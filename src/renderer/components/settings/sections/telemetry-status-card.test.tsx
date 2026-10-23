import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  status: null as unknown,
  isLoading: false,
  testData: undefined as unknown,
  isPending: false,
  mutate: vi.fn(),
}));

vi.mock('@/hooks/use-telemetry', () => ({
  useTelemetryStatusQuery: () => ({ data: mocks.status, isLoading: mocks.isLoading }),
  useTestTelemetryConnection: () => ({
    data: mocks.testData,
    isPending: mocks.isPending,
    mutate: mocks.mutate,
  }),
}));

import { TelemetryStatusCard } from './telemetry-status-card';

const t = i18n.t.bind(i18n);

const status = {
  level: 'full',
  sentry: {
    enabled: true,
    initialized: true,
    reason: null,
    release: 'app@1.0.0',
    environment: 'development',
  },
  otel: {
    enabled: true,
    tracing: true,
    metrics: true,
    logs: true,
    endpointConfigured: true,
  },
  health: {
    traces: {
      attempts: 2,
      failures: 1,
      lastSuccessAt: 1_700_000_000_000,
      lastFailureAt: 1_700_000_001_000,
      lastError: 'refused',
    },
    metrics: {
      attempts: 1,
      failures: 0,
      lastSuccessAt: 1_700_000_000_000,
      lastFailureAt: null,
      lastError: null,
    },
    logs: {
      attempts: 3,
      failures: 0,
      lastSuccessAt: 1_700_000_000_000,
      lastFailureAt: null,
      lastError: null,
    },
    sampledLogs: 2,
    rateLimitedLogs: 1,
    lastDropAt: 1_700_000_002_000,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = status;
  mocks.isLoading = false;
  mocks.testData = undefined;
  mocks.isPending = false;
});

describe('TelemetryStatusCard', () => {
  it('渲染 Sentry/OTel/健康摘要与测试按钮', () => {
    render(<TelemetryStatusCard />);
    expect(screen.getByText(t('settings.obsTitle'))).toBeDefined();
    expect(screen.getByText(t('settings.obsSentry'))).toBeDefined();
    expect(screen.getByText(t('settings.obsTrace'))).toBeDefined();
    expect(screen.getByText(t('settings.obsTest'))).toBeDefined();
    const healthText = t('settings.obsHealth', { attempts: 6, failures: 1, dropped: 3 });
    expect(screen.getByText((content) => content.includes(healthText))).toBeDefined();
  });

  it('加载中/无桥降级', () => {
    mocks.isLoading = true;
    const { rerender } = render(<TelemetryStatusCard />);
    expect(screen.getByText(t('settings.obsLoading'))).toBeDefined();
    mocks.isLoading = false;
    mocks.status = null;
    rerender(<TelemetryStatusCard />);
    expect(screen.getByText(t('settings.obsNoBridge'))).toBeDefined();
  });

  it('未探测原因：off / rate-limited / no-endpoint 本地化', () => {
    const base = {
      sentry: { configured: false, valid: false, message: '' },
      otlp: { checked: false, message: '', results: [] },
    };
    mocks.testData = { ...base, otlp: { ...base.otlp, reason: 'off' } };
    const { rerender } = render(<TelemetryStatusCard />);
    expect(screen.getByText(t('settings.obsTelemetryOff'))).toBeDefined();

    mocks.testData = { ...base, otlp: { ...base.otlp, reason: 'rate-limited' } };
    rerender(<TelemetryStatusCard />);
    expect(screen.getByText(t('settings.obsTestRateLimited'))).toBeDefined();

    mocks.testData = { ...base, otlp: { ...base.otlp, reason: 'no-endpoint' } };
    rerender(<TelemetryStatusCard />);
    expect(screen.getByText(t('settings.obsNoEndpoint'))).toBeDefined();
  });

  it('测试连接：点击触发并展示 OTLP/Sentry 结果', async () => {
    mocks.testData = {
      sentry: { configured: true, valid: true, message: 'ok' },
      otlp: {
        checked: true,
        reason: 'probed',
        message: '1/1',
        results: [
          {
            signal: 'traces',
            url: 'http://localhost/v1/traces',
            ok: true,
            statusCode: 200,
            message: '可达',
          },
        ],
      },
    };
    render(<TelemetryStatusCard />);
    expect(screen.getByText(new RegExp(t('settings.obsSentryValid')))).toBeDefined();
    expect(screen.getByText(new RegExp(`traces.*${t('settings.obsReachable')}`))).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: t('settings.obsTest') }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
});
