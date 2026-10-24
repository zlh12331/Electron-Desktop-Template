import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { type ElectronApplication, _electron as electron, type Page } from 'playwright';
import { unwrap } from '../../src/renderer/lib/ipc';
import {
  assertSmokeConnection,
  assertSmokeSignals,
  assertSmokeStatus,
  buildSmokeEnv,
  runCheckedSmoke,
  type SmokeLevel,
  withSmokeTimeout,
} from './observability-smoke';
import { createSmokeReceiver, type SmokeReceiver } from './observability-smoke-receiver';

export const SMOKE_OBSERVATION_MS = 6_500;

export function parseSmokeLevels(args: readonly string[]): readonly SmokeLevel[] {
  if (args.length === 0) return ['full', 'error-only', 'off'];
  const option = args[0];
  if (args.length === 1 && option?.startsWith('--level=')) {
    const level = option.slice('--level='.length);
    if (level === 'full' || level === 'error-only' || level === 'off') return [level];
  }
  throw new Error(
    'Usage: pnpm observability:smoke [--level=full|error-only|off] (default: all three)',
  );
}

export function isSmokeMainPage(url: string, rendererIndex: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    return resolve(fileURLToPath(parsed)).toLowerCase() === resolve(rendererIndex).toLowerCase();
  } catch {
    return false;
  }
}

async function waitForMainPage(
  app: ElectronApplication,
  rendererIndex: string,
  signal: AbortSignal,
): Promise<Page> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const page = app.windows().find((candidate) => isSmokeMainPage(candidate.url(), rendererIndex));
    if (page !== undefined) {
      await withSmokeTimeout(
        page.waitForLoadState('domcontentloaded'),
        10_000,
        'main page load',
        signal,
      );
      await withSmokeTimeout(
        page.waitForFunction(() => window.api?.telemetry !== undefined),
        10_000,
        'window.api readiness',
        signal,
      );
      return page;
    }
    await delay(100, undefined, { signal });
  }
  throw new Error('main application page not found (DevTools/blank pages excluded)');
}

interface RoundContext {
  readonly level: SmokeLevel;
  readonly marker: string;
  readonly secret: string;
  readonly startedAt: number;
  readonly signal: AbortSignal;
  readonly receiver: SmokeReceiver;
}

async function exercisePage(page: Page, context: RoundContext): Promise<void> {
  const { level, marker, secret, signal, receiver } = context;
  const settings = unwrap(
    await withSmokeTimeout(
      page.evaluate(() => window.api.settings.getAll({})),
      10_000,
      'settings:getAll',
      signal,
    ),
  );
  // 全新模板允许空设置表；这里验证 IPC 契约，不强行要求用户已写过设置。
  assert(
    settings.settings !== null && typeof settings.settings === 'object',
    'settings snapshot malformed',
  );
  const status = unwrap(
    await withSmokeTimeout(
      page.evaluate(() => window.api.telemetry.getStatus()),
      10_000,
      'telemetry:getStatus',
      signal,
    ),
  );
  assertSmokeStatus(status, { level, since: context.startedAt, requireHealth: false });
  if (level === 'full') {
    const result = unwrap(
      await withSmokeTimeout(
        page.evaluate(() => window.api.telemetry.testConnection()),
        10_000,
        'telemetry:testConnection',
        signal,
      ),
    );
    assertSmokeConnection(result, receiver.endpoint);
  }
  const error = unwrap(
    await withSmokeTimeout(
      page.evaluate(
        async ({ marker, secret }) => {
          return await window.api.telemetry.captureError({
            name: 'SmokeSyntheticError',
            message: `${marker} password=${secret}`,
            stack: `SmokeSyntheticError: ${marker} password=${secret}\n    at syntheticLocalSmoke (smoke-local.js:1:1)`,
            tags: { smokeId: marker, password: secret },
          });
        },
        { marker, secret },
      ),
      10_000,
      'telemetry:captureError',
      signal,
    ),
  );
  assert.equal(error.accepted, level !== 'off', 'synthetic error acceptance mismatch');
  const vitals = unwrap(
    await withSmokeTimeout(
      page.evaluate(() =>
        window.api.telemetry.reportWebVitals({
          metrics: [
            { name: 'LCP', value: 2500, rating: 'good', navigationType: 'smoke' },
            { name: 'CLS', value: 0.05, rating: 'good', navigationType: 'smoke' },
          ],
        }),
      ),
      10_000,
      'telemetry:reportWebVitals',
      signal,
    ),
  );
  assert.equal(vitals.accepted, level === 'full' ? 2 : 0, 'Web Vitals acceptance mismatch');
}

async function waitForEvidence(page: Page, context: RoundContext): Promise<void> {
  const { level, receiver, marker, signal, startedAt } = context;
  // 禁用信号也必须跨过默认批处理间隔，瞬间无请求不能证明本轮关闭有效。
  await delay(SMOKE_OBSERVATION_MS, undefined, { signal });
  const deadline = Date.now() + 25_000;
  let lastError: unknown;
  do {
    signal.throwIfAborted();
    const response = await withSmokeTimeout(
      page.evaluate(() => window.api.telemetry.getStatus()),
      10_000,
      'health IPC',
      signal,
    );
    const status = unwrap(response);
    try {
      assertSmokeSignals(receiver.snapshot(), { level, marker });
      assertSmokeStatus(status, { level, since: startedAt, requireHealth: true });
      return;
    } catch (error) {
      lastError = error;
    }
    await delay(200, undefined, { signal });
  } while (Date.now() < deadline);
  throw new Error('timed out waiting for structured smoke evidence', { cause: lastError });
}

async function assertLocalLogs(
  app: ElectronApplication,
  userData: string,
  signal: AbortSignal,
): Promise<void> {
  const logsPath = await withSmokeTimeout(
    app.evaluate(({ app }) => app.getPath('logs')),
    5_000,
    'local logs path',
    signal,
  );
  assert.equal(
    resolve(logsPath),
    resolve(join(userData, 'logs')),
    'logs must stay inside smoke userData',
  );
  const files = await readdir(logsPath);
  const sizes = await Promise.all(
    files
      .filter((name) => name.endsWith('.log'))
      .map(async (name) => (await stat(join(logsPath, name))).size),
  );
  assert(
    sizes.some((size) => size > 0),
    'local logs missing (including off round)',
  );
}

async function runRound(level: SmokeLevel, signal: AbortSignal): Promise<void> {
  const root = resolve(import.meta.dirname, '../..');
  const mainEntry = join(root, 'out', 'main', 'index.js');
  const rendererIndex = join(root, 'out', 'renderer', 'index.html');
  assert(
    existsSync(mainEntry) && existsSync(rendererIndex),
    'build artifacts missing: run pnpm build first',
  );
  // macOS 默认日志目录不跟随 userData，未隔离前不能写入已有应用日志。
  assert(
    process.platform !== 'darwin',
    'macOS requires isolated application logs support; no app launched',
  );
  const marker = `smoke-local-${randomUUID()}`;
  const secret = `synthetic-password-${randomUUID()}`;
  const cleanups: (() => Promise<void>)[] = [];
  let app: ElectronApplication | undefined;
  let appClosed = false;
  let receiver: SmokeReceiver | undefined;
  const startedAt = Date.now();
  await runCheckedSmoke(async () => {
    signal.throwIfAborted();
    const userData = await mkdtemp(join(tmpdir(), 'observability-smoke-'));
    cleanups.push(async () => {
      if (app !== undefined && !appClosed)
        throw new Error(`app not closed; preserved its temporary data: ${userData}`);
      await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      assert(!existsSync(userData), `temporary data cleanup failed: ${userData}`);
    });
    await writeFile(join(userData, 'telemetry-pref.json'), JSON.stringify({ level }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    receiver = await createSmokeReceiver({ forbiddenValues: [secret] });
    const activeReceiver = receiver;
    cleanups.unshift(async () => {
      await activeReceiver.close();
    });
    const env = buildSmokeEnv(process.env, { endpoint: activeReceiver.endpoint, userData });
    signal.throwIfAborted();
    app = await electron.launch({ args: [mainEntry], env, timeout: 20_000 });
    const application = app;
    cleanups.unshift(async () => {
      await application.close();
      appClosed = true;
      assertSmokeSignals(activeReceiver.snapshot(), { level, marker });
    });
    const page = await waitForMainPage(application, rendererIndex, signal);
    const context = { level, marker, secret, startedAt, signal, receiver: activeReceiver };
    await exercisePage(page, context);
    await waitForEvidence(page, context);
    await assertLocalLogs(application, userData, signal);
  }, cleanups);
  signal.throwIfAborted();
  assert(receiver);
  assertSmokeSignals(receiver.snapshot(), { level, marker });
  console.log(
    `[observability-smoke] ${level}: PASS ${JSON.stringify(receiver.snapshot().records)}; observed >=${SMOKE_OBSERVATION_MS}ms plus shutdown; local Sentry synthetic envelope only (not cloud/minidump validation)`,
  );
}

export async function runLocalSmoke(args: readonly string[]): Promise<void> {
  const levels = parseSmokeLevels(args);
  const controller = new AbortController();
  const interrupt = (): void => controller.abort(new Error('smoke interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    for (const level of levels) await runRound(level, controller.signal);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
