import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ipcErr, ipcOk } from '@/lib/ipc-factories';

import {
  TELEMETRY_LEVEL_QUERY_KEY,
  TELEMETRY_STATUS_QUERY_KEY,
  useSetTelemetryLevel,
  useTelemetryLevelQuery,
  useTelemetryStatusQuery,
  useTestTelemetryConnection,
} from './use-telemetry';

const statusSnapshot = {
  level: 'full',
  configuredLevel: 'full',
  restartRequired: false,
  sentry: {
    enabled: false,
    initialized: false,
    reason: 'no-dsn',
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
    traces: { attempts: 1, failures: 0, lastSuccessAt: 1, lastFailureAt: null, lastError: null },
    metrics: { attempts: 1, failures: 0, lastSuccessAt: 1, lastFailureAt: null, lastError: null },
    logs: { attempts: 1, failures: 0, lastSuccessAt: 1, lastFailureAt: null, lastError: null },
    sampledLogs: 0,
    rateLimitedLogs: 0,
    suppressedErrors: 0,
    lastDropAt: null,
  },
} as const;

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, queryClient };
}

function mockTelemetryApi(impl: Record<string, ReturnType<typeof vi.fn>>): void {
  (window.api as unknown as Record<string, Record<string, unknown>>)['telemetry'] = {
    ...((window.api as unknown as Record<string, Record<string, unknown>>)['telemetry'] as Record<
      string,
      unknown
    >),
    ...impl,
  };
}

function mockSettingsApi(impl: Record<string, ReturnType<typeof vi.fn>>): void {
  (window.api as unknown as Record<string, Record<string, unknown>>)['settings'] = {
    ...((window.api as unknown as Record<string, Record<string, unknown>>)['settings'] as Record<
      string,
      unknown
    >),
    ...impl,
  };
}

function removeBridge(): void {
  (window as unknown as { api: undefined }).api = undefined;
}

describe('use-telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useTelemetryLevelQuery', () => {
    it('bridge success returns level string', async () => {
      mockSettingsApi({ getTelemetryLevel: vi.fn(async () => ipcOk({ level: 'error-only' })) });
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTelemetryLevelQuery(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe('error-only');
    });

    it('no bridge degrades to off', async () => {
      removeBridge();
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTelemetryLevelQuery(), { wrapper });
      await waitFor(() => expect(result.current.data).toBe('off'));
    });
  });

  describe('useSetTelemetryLevel', () => {
    it('success invalidates level query', async () => {
      mockSettingsApi({
        getTelemetryLevel: vi.fn(async () => ipcOk({ level: 'off' })),
        setTelemetryLevel: vi.fn(async () => ipcOk({ ok: true, level: 'full' })),
      });
      const { wrapper, queryClient } = createWrapper();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useSetTelemetryLevel(), { wrapper });
      result.current.mutate('full');
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(spy).toHaveBeenCalledWith({ queryKey: TELEMETRY_LEVEL_QUERY_KEY });
    });

    it('no bridge throws and toasts error', async () => {
      removeBridge();
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useSetTelemetryLevel(), { wrapper });
      result.current.mutate('full');
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(toast.error).toHaveBeenCalled();
    });

    it('IPC error response is failure', async () => {
      mockSettingsApi({
        setTelemetryLevel: vi.fn(async () => ipcErr('SETTINGS_WRITE_FAILED', 'disk full')),
      });
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useSetTelemetryLevel(), { wrapper });
      result.current.mutate('error-only');
      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useTelemetryStatusQuery', () => {
    it('bridge success 返回完整状态', async () => {
      mockTelemetryApi({ getStatus: vi.fn(async () => ipcOk(statusSnapshot)) });
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTelemetryStatusQuery(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toMatchObject({ level: 'full', otel: { logs: true } });
    });

    it('no bridge 返回 null，且 queryKey 固定', async () => {
      removeBridge();
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTelemetryStatusQuery(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
      expect(TELEMETRY_STATUS_QUERY_KEY).toEqual(['telemetry-status']);
    });
  });

  describe('useTestTelemetryConnection', () => {
    it('success 返回探测结果', async () => {
      const response = {
        sentry: { configured: false, valid: false, message: '未配置 DSN' },
        otlp: {
          checked: true,
          reason: 'probed',
          message: '1/1 个端点可达',
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
      mockTelemetryApi({ testConnection: vi.fn(async () => ipcOk(response)) });
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTestTelemetryConnection(), { wrapper });
      result.current.mutate();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(response);
    });

    it('no bridge 失败并 toast', async () => {
      removeBridge();
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTestTelemetryConnection(), { wrapper });
      result.current.mutate();
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(toast.error).toHaveBeenCalled();
    });
  });
});
