// mock-api.ts：浏览器模式（pnpm dev:web）的 window.api 模拟实现
//
// 为什么需要：dev:web 不经 Electron，没有 preload 注入的 window.api。本文件提供
// 与 IPC 契约同形的假实现，使渲染层能在浏览器里独立调试（Vite HMR 比 Electron 快）。
// 边界：只实现当前模板保留的域（通用域与随模板保留的示例域）；新增业务域时在此补对应 mock。
import {
  IPC_PROTOCOL_VERSION,
  type IpcApi,
  type Note,
  type UpdateStatusPayload,
} from '@code-agent/shared/renderer';

import { ipcErr, ipcOk } from '@/lib/ipc-factories';

/** 浏览器模式下内存态的假设置（不落库，刷新即重置） */
const memorySettings = new Map<string, unknown>([
  ['theme', 'dark'],
  ['language', 'zh-CN'],
  ['window', { closeAction: 'minimize' }],
  ['notification', { enabled: true }],
  ['proxy', { mode: 'system' }],
  ['appearance', { zoom: 1 }],
]);

/** 假备份列表 */
const mockBackups = [
  {
    name: '2026-01-01T00-00-00',
    sizeBytes: 1_048_576,
    createdAtMs: Date.now() - 86_400_000,
    healthy: true,
  },
];

// notes-example:start
/** 浏览器模式的笔记内存库（刷新即重置） */
let mockNotes: Note[] = [
  {
    id: 'mock-note-welcome',
    title: '欢迎使用 Local Notes',
    body: '这是浏览器模式的示例笔记。\n\n在 Electron 模式中，笔记会写入 SQLite 并在重启后保留。',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
  },
];

function mockNoteSummary(note: Note) {
  return {
    id: note.id,
    title: note.title,
    preview: note.body.replace(/\s+/g, ' ').trim().slice(0, 160),
    updatedAt: note.updatedAt,
  };
}

/** 浏览器模式的 notes 域假实现（内存态，与 IPC 契约同形） */
function createMockNotesApi(): IpcApi['notes'] {
  return {
    list: async (input) => {
      const keyword = input?.query?.trim().toLowerCase() ?? '';
      const notes = mockNotes
        .filter(
          (note) =>
            keyword === '' ||
            note.title.toLowerCase().includes(keyword) ||
            note.body.toLowerCase().includes(keyword),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(mockNoteSummary);
      return ipcOk({ notes });
    },
    get: async (input) => {
      const note = mockNotes.find((item) => item.id === input.id);
      if (note === undefined) {
        return ipcErr('NOT_FOUND', `note not found: ${input.id}`);
      }
      return ipcOk({ note });
    },
    create: async (input) => {
      const now = Date.now();
      const note: Note = {
        id: crypto.randomUUID(),
        title: input.title,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      };
      mockNotes = [note, ...mockNotes];
      return ipcOk({ note });
    },
    update: async (input) => {
      const note = mockNotes.find((item) => item.id === input.id);
      if (note === undefined) {
        return ipcErr('NOT_FOUND', `note not found: ${input.id}`);
      }
      const next: Note = {
        ...note,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        updatedAt: Date.now(),
      };
      mockNotes = mockNotes.map((item) => (item.id === next.id ? next : item));
      return ipcOk({ note: next });
    },
    delete: async (input) => {
      mockNotes = mockNotes.filter((item) => item.id !== input.id);
      return ipcOk({ ok: true });
    },
    importFile: async (input) => {
      const now = Date.now();
      const filename = input.path.split(/[\\/]/).pop() ?? 'Imported note';
      const note: Note = {
        id: crypto.randomUUID(),
        title: filename.replace(/\.md$/i, ''),
        body: '浏览器模式不读取真实文件。',
        createdAt: now,
        updatedAt: now,
      };
      mockNotes = [note, ...mockNotes];
      return ipcOk({ note });
    },
    exportFile: async () => ipcOk({ saved: false }),
  };
}
// notes-example:end

/** 浏览器模式下的假凭据库（内存态；掩码算法与主进程 maskSecret 保持一致） */
const memorySecrets = new Map<string, string>();

/** 假更新状态（browser 模式不真查更新）：契约是 {snapshot, lastCheckAt} 快照形态 */
const mockUpdateSnapshot: UpdateStatusPayload = {
  phase: 'not-available',
};

/** 安装 mock：把假 api 挂到 window.api（仅 dev:web 调用一次） */
export function installMockApi(): void {
  window.api = createMockApi();
}

/** 构建与 IPC 契约同形的假 API（导出供 IPC_META 契约测试复用） */
export function createMockApi(): IpcApi {
  return {
    app: {
      getStatus: async () => ipcOk({ ready: true, protocolVersion: IPC_PROTOCOL_VERSION }),
      getInfo: async () =>
        ipcOk({
          version: '0.0.0-dev',
          electron: 'n/a',
          node: 'n/a',
          chrome: 'n/a',
          platform: 'web',
          arch: 'n/a',
          userDataPath: '/tmp/mock-user-data',
          channel: 'dev',
        }),
      openExternal: async () => ipcOk({ ok: true }),
      openDataDir: async () => ipcOk({ ok: true }),
      exportDiagnostics: async () => ipcOk({ saved: false }),
      getLoginItemSettings: async () =>
        ipcOk({ openAtLogin: false, supported: false, requiresApproval: false }),
      setLoginItemSettings: async () =>
        ipcOk({ openAtLogin: false, supported: false, requiresApproval: false }),
      quit: async () => ipcOk({ ok: true }),
      subscribeDeepLink: () => () => {},
      subscribeLoginItemChanged: () => () => {},
      takePendingDeepLink: async () => ipcOk({ payload: null }),
    },
    window: {
      applyZoom: async () => ipcOk({ ok: true }),
    },
    backup: {
      list: async () => ipcOk({ backups: mockBackups }),
      create: async () => ipcOk({ name: `manual-${Date.now()}` }),
      restore: async () => ipcOk({ ok: true }),
    },
    settings: {
      getAll: async () => ipcOk({ settings: Object.fromEntries(memorySettings) }),
      resetAll: async () => {
        memorySettings.clear();
        return ipcOk({ settings: {} });
      },
      set: async (input: { key: string; value: unknown }) => {
        memorySettings.set(input.key, input.value);
        return ipcOk({ ok: true });
      },
      getTelemetryLevel: async () => ipcOk({ level: 'error-only' as const }),
      setTelemetryLevel: async (input: { level: 'off' | 'error-only' | 'full' }) =>
        ipcOk({ ok: true, level: input.level }),
      exportSettings: async () => ipcOk({ saved: false }),
      importSettings: async () => ipcOk({ imported: 0, skipped: 0 }),
      subscribeChanged: () => () => {},
    },
    telemetry: {
      captureError: async () => ipcOk({ accepted: false }),
      reportWebVitals: async () => ipcOk({ accepted: 0 }),
      rendererReady: async () => ipcOk({ accepted: false }),
      getStatus: async () =>
        ipcOk({
          level: 'off' as const,
          configuredLevel: 'off' as const,
          restartRequired: false,
          sentry: {
            enabled: false,
            initialized: false,
            reason: 'telemetry-off' as const,
            release: null,
            environment: null,
          },
          otel: {
            enabled: false,
            tracing: false,
            metrics: false,
            logs: false,
            endpointConfigured: false,
          },
          health: {
            traces: {
              attempts: 0,
              failures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastError: null,
            },
            metrics: {
              attempts: 0,
              failures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastError: null,
            },
            logs: {
              attempts: 0,
              failures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastError: null,
            },
            sampledLogs: 0,
            rateLimitedLogs: 0,
            suppressedErrors: 0,
            lastDropAt: null,
          },
        }),
      testConnection: async () =>
        ipcOk({
          sentry: { configured: false, valid: false, message: '未配置 DSN' },
          otlp: {
            checked: false,
            reason: 'off' as const,
            message: '浏览器 mock 不探测',
            results: [],
          },
        }),
    },
    proxy: {
      test: async () => ipcOk({ ok: true, kind: 'not-applicable' as const }),
      clearAuth: async () => ipcOk({ ok: true }),
    },
    secrets: {
      isAvailable: async () =>
        ipcOk({
          available: true,
          platform: 'web',
          backend: null,
          reason: 'ok' as const,
        }),
      list: async () => ipcOk({ keys: [...memorySecrets.keys()].sort() }),
      set: async (input: { key: string; value: string }) => {
        memorySecrets.set(input.key, input.value);
        return ipcOk({ ok: true });
      },
      delete: async (input: { key: string }) => {
        memorySecrets.delete(input.key);
        return ipcOk({ ok: true });
      },
      getMasked: async (input: { key: string }) => {
        const value = memorySecrets.get(input.key);
        return ipcOk({
          masked: value === undefined ? null : `${value.slice(0, 3)}****${value.slice(-4)}`,
        });
      },
    },
    system: {
      getStatus: async () =>
        ipcOk({
          appVersion: '0.0.0-dev',
          electronVersion: 'n/a',
          nodeVersion: 'n/a',
          platform: 'web',
          arch: 'n/a',
          isPackaged: false,
          uptimeSeconds: 0,
          pid: 0,
          memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
          cpu: { user: 0, system: 0 },
          timestamp: new Date().toISOString(),
        }),
    },
    logs: {
      read: async () => ipcOk({ lines: [], total: 0, filePath: '', truncated: false }),
    },
    devtools: {
      open: async () => ipcOk({ ok: true, mode: 'detach' as const }),
    },
    dialog: {
      pickDirectory: async () => ipcOk({ canceled: true }),
      pickFiles: async () => ipcOk({ canceled: true }),
    },
    invalidation: {
      subscribeDomains: () => () => {},
    },
    // notes-example:start
    notes: createMockNotesApi(),
    // notes-example:end
    update: {
      check: async () => ipcOk({ status: 'checking' as const }),
      install: async () => ipcOk({ ok: true }),
      cancel: async () => ipcOk({ ok: true }),
      getStatus: async () => ipcOk({ snapshot: mockUpdateSnapshot, lastCheckAt: null }),
      getCacheInfo: async () => ipcOk({ path: '/tmp/mock-updater', bytes: 0, fileCount: 0 }),
      clearCache: async () => ipcOk({ path: '/tmp/mock-updater', bytes: 0, fileCount: 0 }),
      subscribeStatus: () => () => {},
    },
  } satisfies IpcApi;
}
