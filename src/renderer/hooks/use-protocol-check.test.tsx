import { IPC_PROTOCOL_VERSION } from '@code-agent/shared/renderer';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  warning: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { warning: mocks.warning, error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/error-report', () => ({
  reportError: mocks.reportError,
}));

import { useProtocolCheck } from './use-protocol-check';

const originalGetStatus = window.api.app.getStatus;

describe('useProtocolCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.api.app.getStatus = originalGetStatus;
  });

  it('协议版本不一致时提示重启', async () => {
    window.api.app.getStatus = vi.fn(async () => ({
      data: { ready: true, protocolVersion: IPC_PROTOCOL_VERSION + 1 },
    }));
    renderHook(() => useProtocolCheck());
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
  });

  it('版本一致时静默', async () => {
    window.api.app.getStatus = vi.fn(async () => ({
      data: { ready: true, protocolVersion: IPC_PROTOCOL_VERSION },
    }));
    renderHook(() => useProtocolCheck());
    await waitFor(() => expect(window.api.app.getStatus).toHaveBeenCalled());
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('校验失败上报错误而非抛出', async () => {
    window.api.app.getStatus = vi.fn().mockRejectedValue(new Error('boom'));
    renderHook(() => useProtocolCheck());
    await waitFor(() => expect(mocks.reportError).toHaveBeenCalled());
  });
});
