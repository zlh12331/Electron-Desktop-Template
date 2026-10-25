import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { COLLECTOR_IMAGE, STORAGE_INIT_IMAGE } from './collector-smoke-fixtures';

const exec = promisify(execFile);
const ownerLabel = 'io.electron-desktop-template.collector-smoke';

/** Bounded, shell-free Docker invocation; never passes through real OTLP environment variables. */
export async function docker(args: string[], timeout = 60_000): Promise<string> {
  try {
    const { stdout, stderr } = await exec('docker', args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    throw new Error(`docker ${args.join(' ')} failed: ${String(error)}`, { cause: error });
  }
}

/** Missing pinned images must be fetched explicitly; failures are never interpreted as a skip/pass. */
export async function ensureImage(image: string): Promise<void> {
  try {
    await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
    return;
  } catch {
    console.log(`[collector-smoke] Pulling ${image}`);
  }
  await docker(['pull', image], 180_000);
}

/** Polls actual state, with the last unmet condition preserved in the failure message. */
export async function waitFor(
  description: string,
  check: () => Promise<void>,
  signal: AbortSignal,
  timeout = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
    }
    await delay(500, undefined, { signal });
  }
  throw new Error(`${description}: timeout after ${timeout}ms; ${String(lastError)}`);
}

/** Reserve a loopback port, then release it immediately for an explicit Docker publish mapping. */
export async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('No loopback port');
  return address.port;
}

/** Mount syntax works with native absolute Windows paths and does not invoke MSYS path rewriting. */
export function configMount(file: string, destination = 'collector.yaml'): string[] {
  return ['--mount', `type=bind,source=${file},target=/etc/otelcol/${destination},readonly`];
}

/** Hardened runtime settings shared with the production Compose relay. */
export const RUNTIME_ARGS: readonly string[] = [
  '--read-only',
  '--user',
  '10001:10001',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--memory',
  '512m',
  '--env',
  'GOMEMLIMIT=320MiB',
];

/** Manages ONLY resources carrying this invocation's unpredictable ownership label. */
export class DockerScope {
  readonly #runId: string;
  readonly #containers = new Set<string>();

  constructor(runId: string) {
    this.#runId = runId;
  }

  get network(): string {
    return `${this.#runId}-network`;
  }

  #labelArgs(): string[] {
    return ['--label', `${ownerLabel}=${this.#runId}`];
  }

  async createNetwork(): Promise<void> {
    // No route to the real upstream, even if a fixture endpoint were accidentally misconfigured.
    await docker(['network', 'create', '--internal', ...this.#labelArgs(), this.network]);
    // Host-published ports cannot reach an internal-only network; relay joins both.
    await docker(['network', 'create', ...this.#labelArgs(), `${this.network}-host`]);
  }

  async connectHostNetwork(id: string): Promise<void> {
    this.#assertOwned(id);
    await docker(['network', 'connect', `${this.network}-host`, id]);
  }

  async createContainer(name: string, args: string[]): Promise<string> {
    const id = await docker([
      'create',
      '--name',
      `${this.#runId}-${name}`,
      ...this.#labelArgs(),
      ...args,
    ]);
    // docker create may print pull warnings on stderr; only a full ID is accepted.
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error(`Unexpected container ID: ${id}`);
    this.#containers.add(id);
    return id;
  }

  #assertOwned(id: string): void {
    if (!this.#containers.has(id))
      throw new Error(`Refusing to operate on unowned container ${id}`);
  }

  async start(id: string): Promise<void> {
    this.#assertOwned(id);
    await docker(['start', id]);
  }

  async runToCompletion(id: string): Promise<void> {
    this.#assertOwned(id);
    const output = await docker(['start', '--attach', id]);
    const code = await docker(['inspect', '--format', '{{.State.ExitCode}}', id]);
    if (code !== '0') throw new Error(`Container exited ${code}: ${output}`);
  }

  async stop(id: string): Promise<void> {
    this.#assertOwned(id);
    await docker(['stop', '--time', '10', id]);
  }

  async crash(id: string): Promise<void> {
    this.#assertOwned(id);
    await docker(['kill', '--signal', 'KILL', id]);
    const code = await docker(['inspect', '--format', '{{.State.ExitCode}}', id]);
    if (code !== '137') throw new Error(`Expected SIGKILL exit 137, got ${code}`);
  }

  async logs(id: string): Promise<string> {
    this.#assertOwned(id);
    return docker(['logs', id]);
  }

  async assertRunning(id: string): Promise<void> {
    this.#assertOwned(id);
    const running = await docker(['inspect', '--format', '{{.State.Running}}', id]);
    if (running !== 'true') throw new Error(`Owned container stopped: ${await this.logs(id)}`);
  }

  async endpoint(id: string, port: number): Promise<string> {
    this.#assertOwned(id);
    // Some engines omit docker-port output until first connection; inspect is stable.
    const raw = await docker(['inspect', '--format', '{{json .HostConfig.PortBindings}}', id]);
    const bindings = JSON.parse(raw) as Record<
      string,
      { ['HostIp']?: string; ['HostPort']?: string }[]
    >;
    const binding = bindings[`${port}/tcp`]?.[0];
    const address =
      binding?.['HostIp'] === undefined || binding['HostPort'] === undefined
        ? undefined
        : `${binding['HostIp']}:${binding['HostPort']}`;
    if (address === undefined || !/^127\.0\.0\.1:\d+$/.test(address)) {
      throw new Error(`Not a loopback binding for ${port}: ${raw}`);
    }
    return `http://${address}`;
  }

  async createQueue(name: string): Promise<string> {
    const volume = `${this.#runId}-${name}`;
    await docker(['volume', 'create', ...this.#labelArgs(), volume]);
    const init = await this.createContainer(`${name}-init`, [
      '--read-only',
      '--user',
      '0:0',
      '--network',
      'none',
      '--memory',
      '32m',
      '--cap-drop',
      'ALL',
      '--cap-add',
      'CHOWN',
      '--cap-add',
      'FOWNER',
      '--security-opt',
      'no-new-privileges',
      '--mount',
      `type=volume,source=${volume},target=/var/lib/otelcol`,
      STORAGE_INIT_IMAGE,
      'sh',
      '-ec',
      'chmod 0700 /var/lib/otelcol; chown 10001:10001 /var/lib/otelcol',
    ]);
    await this.runToCompletion(init);
    return volume;
  }

  async validate(name: string, mounts: string[], configs: string[]): Promise<void> {
    await docker([
      'run',
      '--rm',
      '--name',
      `${this.#runId}-validate-${name}`,
      ...this.#labelArgs(),
      ...RUNTIME_ARGS,
      '--network',
      'none',
      ...mounts,
      '--env',
      'OTLP_UPSTREAM_ENDPOINT=http://sink:4318',
      COLLECTOR_IMAGE,
      'validate',
      ...configs.map((config) => `--config=/etc/otelcol/${config}`),
    ]);
    console.log(`[collector-smoke] ${name}: image validate passed`);
  }

  async cleanup(): Promise<void> {
    // Label discovery also catches a create completed by the daemon after a CLI timeout.
    const filter = ['--filter', `label=${ownerLabel}=${this.#runId}`];
    const errors: unknown[] = [];
    const groups = [
      { list: ['ps', '--all', '--quiet'], remove: ['rm', '--force'] },
      { list: ['network', 'ls', '--quiet'], remove: ['network', 'rm'] },
      { list: ['volume', 'ls', '--quiet'], remove: ['volume', 'rm'] },
    ];
    for (const group of groups) {
      try {
        const ids = (await docker([...group.list, ...filter])).split(/\s+/).filter(Boolean);
        for (const id of ids) await docker([...group.remove, id]);
        const remaining = await docker([...group.list, ...filter]);
        if (remaining !== '') throw new Error(`Owned resources remain: ${remaining}`);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `Cleanup failed for ${this.#runId}`);
  }
}
