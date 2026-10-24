// Standalone Docker acceptance; no Electron build, real .env, telemetry, or existing stack is used.
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  configMount,
  DockerScope,
  docker,
  ensureImage,
  freeLoopbackPort,
  RUNTIME_ARGS,
  waitFor,
} from './lib/collector-smoke-docker';
import {
  COLLECTOR_IMAGE,
  droppedTailTraces,
  makeBatch,
  missingMarkers,
  queueSizes,
  SIGNALS,
  SINK_CONFIG,
  STORAGE_INIT_IMAGE,
  type SyntheticBatch,
  zeroPercentTailFixture,
} from './lib/collector-smoke-fixtures';

const configDir = resolve(import.meta.dirname, '../observability/collector');

interface Relay {
  id: string;
  ingest: string;
  metrics: string;
}

interface Scenario {
  scope: DockerScope;
  signal: AbortSignal;
  sink: string;
  config: string;
  runId: string;
}

async function metricsText(relay: Relay): Promise<string> {
  const response = await fetch(`${relay.metrics}/metrics`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Self metrics HTTP ${response.status}`);
  return response.text();
}

async function sendBatch(relay: Relay, batch: SyntheticBatch, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${relay.ingest}/v1/${batch.signal}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch.body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Synthetic ${batch.signal}: HTTP ${response.status}: ${text}`);
  const result = JSON.parse(text) as { partialSuccess?: Record<string, unknown> };
  if (
    Object.values(result.partialSuccess ?? {}).some(
      (value) => value !== '' && value !== 0 && value !== '0',
    )
  ) {
    throw new Error(`Collector partially rejected synthetic ${batch.signal}: ${text}`);
  }
}

async function assertDelivered(scope: DockerScope, sink: string, markers: string[]): Promise<void> {
  await scope.assertRunning(sink);
  const missing = missingMarkers(await scope.logs(sink), markers);
  if (missing.length > 0)
    throw new Error(`Missing ${missing.length} downstream IDs: ${missing.slice(0, 3).join(', ')}`);
}

async function relayEndpoints(scope: DockerScope, id: string): Promise<Relay> {
  return { id, ingest: await scope.endpoint(id, 4318), metrics: await scope.endpoint(id, 8888) };
}

async function startRelay(context: Scenario, name: string, overlay?: string): Promise<Relay> {
  const { scope, signal, config } = context;
  const volume = await scope.createQueue(`${name}-queue`);
  const extraMount = overlay ? configMount(overlay, 'tail.yaml') : [];
  const extraConfig = overlay ? ['--config=/etc/otelcol/tail.yaml'] : [];
  const httpPort = await freeLoopbackPort();
  const metricsPort = await freeLoopbackPort();
  const id = await scope.createContainer(name, [
    ...RUNTIME_ARGS,
    '--network',
    scope.network,
    '--publish',
    `127.0.0.1:${String(httpPort)}:4318`,
    '--publish',
    `127.0.0.1:${String(metricsPort)}:8888`,
    '--env',
    'OTLP_UPSTREAM_ENDPOINT=http://sink:4318',
    ...configMount(config),
    ...extraMount,
    '--mount',
    `type=volume,source=${volume},target=/var/lib/otelcol`,
    COLLECTOR_IMAGE,
    '--config=/etc/otelcol/collector.yaml',
    ...extraConfig,
  ]);
  await scope.connectHostNetwork(id);
  await scope.start(id);
  await scope.assertRunning(id);
  const relay = await relayEndpoints(scope, id);
  await waitFor(
    `${name} startup`,
    async () => {
      await scope.assertRunning(id);
      await metricsText(relay);
    },
    signal,
  );
  return relay;
}

async function durableQueueScenario(context: Scenario): Promise<void> {
  const { scope, signal, sink, runId } = context;
  const relay = await startRelay(context, 'relay');
  const baseline: string[] = [];
  for (const kind of SIGNALS) {
    const batch = makeBatch(kind, `${runId}-baseline`, 1);
    baseline.push(...batch.markers);
    await sendBatch(relay, batch, signal);
  }
  await waitFor(
    'Three-signal baseline delivery',
    () => assertDelivered(scope, sink, baseline),
    signal,
  );
  console.log('[collector-smoke] Baseline traces/metrics/logs reached the synthetic sink');

  await scope.stop(sink);
  const offline: string[] = [];
  // A full batch reaches the exporter immediately; multiple waves exceed both queue consumers.
  for (let wave = 0; wave < 6; wave += 1) {
    for (const kind of SIGNALS) {
      const batch = makeBatch(kind, `${runId}-offline-${wave}`, 256);
      offline.push(...batch.markers);
      await sendBatch(relay, batch, signal);
    }
  }
  console.log(`[collector-smoke] Sender stopped; ${offline.length} unique offline IDs submitted`);
  let stableSamples = 0;
  let previous = '';
  await waitFor(
    'All three queues nonempty and stable with sender stopped',
    async () => {
      await scope.assertRunning(relay.id);
      const sizes = queueSizes(await metricsText(relay));
      if (SIGNALS.some((kind) => sizes[kind] <= 0))
        throw new Error(`Queues: ${JSON.stringify(sizes)}`);
      const snapshot = JSON.stringify(sizes);
      stableSamples = snapshot === previous ? stableSamples + 1 : 0;
      previous = snapshot;
      if (stableSamples < 4) throw new Error(`Waiting for stable queue sizes: ${snapshot}`);
    },
    signal,
  );
  if (missingMarkers(await scope.logs(sink), offline).length !== offline.length) {
    throw new Error('Offline fixtures unexpectedly arrived before the crash');
  }
  console.log(`[collector-smoke] Before SIGKILL queue_size=${previous}`);
  await scope.crash(relay.id);
  await scope.start(relay.id);
  const recovered = await relayEndpoints(scope, relay.id);
  await waitFor(
    'Persistent queues restored before sink recovery',
    async () => {
      await scope.assertRunning(recovered.id);
      const sizes = queueSizes(await metricsText(recovered));
      if (SIGNALS.some((kind) => sizes[kind] <= 0))
        throw new Error(`Restored queues: ${JSON.stringify(sizes)}`);
    },
    signal,
  );
  await scope.start(sink);
  await waitFor(
    'Every offline ID delivered after SIGKILL and queue drained',
    async () => {
      await scope.assertRunning(recovered.id);
      await assertDelivered(scope, sink, [...baseline, ...offline]);
      const sizes = queueSizes(await metricsText(recovered));
      if (SIGNALS.some((kind) => sizes[kind] !== 0))
        throw new Error(`Not drained: ${JSON.stringify(sizes)}`);
    },
    signal,
    90_000,
  );
  console.log(
    `[collector-smoke] SIGKILL recovery: all ${offline.length} offline IDs delivered; all queue_size=0 (duplicates allowed)`,
  );
  await scope.stop(recovered.id);
}

async function tailSamplingScenario(context: Scenario, overlay: string): Promise<void> {
  const { scope, signal, sink, runId } = context;
  const relay = await startRelay(context, 'tail-relay', overlay);
  const normal = makeBatch('traces', `${runId}-tail-normal`, 5);
  const error = makeBatch('traces', `${runId}-tail-error`, 1, 'error');
  const slow = makeBatch('traces', `${runId}-tail-slow`, 1, 'slow');
  for (const batch of [normal, error, slow]) await sendBatch(relay, batch, signal);
  await waitFor(
    '30s tail decisions: retain error/slow, drop 0% normal',
    async () => {
      await scope.assertRunning(relay.id);
      await assertDelivered(scope, sink, [...error.markers, ...slow.markers]);
      const metrics = await metricsText(relay);
      if (droppedTailTraces(metrics) < normal.markers.length)
        throw new Error('Normal trace decisions not complete');
      if (missingMarkers(await scope.logs(sink), normal.markers).length !== normal.markers.length) {
        throw new Error('0% normal traces reached the sink');
      }
    },
    signal,
    75_000,
  );
  // Flush the relay before the final negative assertion so a late batch cannot yield a false pass.
  await scope.stop(relay.id);
  if (missingMarkers(await scope.logs(sink), normal.markers).length !== normal.markers.length) {
    throw new Error('0% normal traces arrived during final flush');
  }
  console.log(
    '[collector-smoke] Tail sampling: ERROR and 1500ms traces retained; all five 0% normal traces dropped',
  );
}

async function existingContainers(): Promise<Map<string, string>> {
  const lines = await docker(['ps', '--all', '--no-trunc', '--format', '{{.ID}} {{.State}}']);
  return new Map(
    lines
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id = '', state = ''] = line.split(' ');
        return [id, state];
      }),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: pnpm exec tsx scripts/collector-smoke.ts\nRequires Docker. Pulls pinned images if missing. Uses isolated synthetic resources and removes them in finally.',
    );
    return;
  }
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(' ')}`);
  await docker(['version', '--format', '{{.Server.Version}}']);
  const baseline = await existingContainers();
  const runId = `collector-smoke-${randomUUID()}`;
  const scope = new DockerScope(runId);
  const controller = new AbortController();
  const interrupt = (): void => controller.abort(new Error('Collector smoke interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let temp: string | undefined;
  const failures: unknown[] = [];
  console.log(`[collector-smoke] Isolated run: ${runId}`);
  try {
    await ensureImage(COLLECTOR_IMAGE);
    controller.signal.throwIfAborted();
    const config = join(configDir, 'collector.yaml');
    const tail = join(configDir, 'tail-sampling.yaml');
    temp = await mkdtemp(join(tmpdir(), `${runId}-`));
    const sinkConfig = join(temp, 'sink.yaml');
    const zeroTail = join(temp, 'zero-tail.yaml');
    await writeFile(sinkConfig, SINK_CONFIG);
    await writeFile(zeroTail, zeroPercentTailFixture(await readFile(tail, 'utf8')));
    await scope.validate('base', configMount(config), ['collector.yaml']);
    await scope.validate(
      'production-tail',
      [...configMount(config), ...configMount(tail, 'tail.yaml')],
      ['collector.yaml', 'tail.yaml'],
    );
    await scope.validate(
      'zero-tail-fixture',
      [...configMount(config), ...configMount(zeroTail, 'tail.yaml')],
      ['collector.yaml', 'tail.yaml'],
    );
    await scope.validate('synthetic-sink', configMount(sinkConfig), ['collector.yaml']);
    await ensureImage(STORAGE_INIT_IMAGE);
    controller.signal.throwIfAborted();
    await scope.createNetwork();
    const sink = await scope.createContainer('sink', [
      ...RUNTIME_ARGS,
      '--network',
      scope.network,
      '--network-alias',
      'sink',
      ...configMount(sinkConfig),
      COLLECTOR_IMAGE,
      '--config=/etc/otelcol/collector.yaml',
    ]);
    await scope.start(sink);
    const context: Scenario = { scope, signal: controller.signal, sink, config, runId };
    await durableQueueScenario(context);
    await tailSamplingScenario(context, zeroTail);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await scope.cleanup();
    } catch (error) {
      failures.push(error);
    }
    try {
      if (temp) await rm(temp, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    try {
      const after = await existingContainers();
      for (const [id, state] of baseline) {
        if (after.get(id) !== state) {
          failures.push(new Error(`Pre-existing container state changed: ${id}`));
        }
      }
    } catch (error) {
      failures.push(error);
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `Collector acceptance failed (${runId}); ${failures.map(String).join('\n')}`,
    );
  console.log(
    '[collector-smoke] PASS: image validate, persistent three-signal crash recovery, tail policies, cleanup, existing-container invariance',
  );
}

await main().catch((error: unknown) => {
  console.error('[collector-smoke] FAIL:', error);
  process.exitCode = 1;
});
