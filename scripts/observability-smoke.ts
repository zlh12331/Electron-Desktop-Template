// observability-smoke.ts：真实 Electron 的 OTLP 信号冒烟——启动应用，等待 traces/metrics/logs 各至少 1 次
// 前置：pnpm build（需要 out/main/index.js 与 out/renderer）
// 说明：用本地 HTTP 服务接收 OTLP 请求，只验证“发出并能到达”，不解析 protobuf 内容

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron } from 'playwright';

const root = join(import.meta.dirname, '..');
const mainEntry = join(root, 'out', 'main', 'index.js');
const rendererIndex = join(root, 'out', 'renderer', 'index.html');

if (!existsSync(mainEntry) || !existsSync(rendererIndex)) {
  console.error('[observability-smoke] 缺少构建产物：先执行 pnpm build');
  process.exit(1);
}

const counts = { traces: 0, metrics: 0, logs: 0 };
const server = createServer((request, response) => {
  if (request.method === 'POST') {
    if (request.url === '/v1/traces') counts.traces += 1;
    if (request.url === '/v1/metrics') counts.metrics += 1;
    if (request.url === '/v1/logs') counts.logs += 1;
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (address === null || typeof address === 'string') {
  console.error('[observability-smoke] 无法获取本地端口');
  process.exit(1);
}
const endpoint = `http://127.0.0.1:${address.port}`;
const userData = mkdtempSync(join(tmpdir(), 'observability-smoke-'));

const env: NodeJS.ProcessEnv = { ...process.env };
delete env['ELECTRON_RUN_AS_NODE'];
env['NODE_ENV'] = 'development';
env['APP_USER_DATA'] = userData;
env['APP_DEBUG_PORT'] = '9225';
env['APP_SKIP_CLOSE_GUARD'] = '1';
env['OTEL_EXPORTER_OTLP_ENDPOINT'] = endpoint;
env['OTEL_METRIC_EXPORT_INTERVAL'] = '1000';
env['OTEL_LOG_LEVEL'] = 'info';

const launchEnv: Record<string, string> = Object.fromEntries(
  Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

/** 过滤 dev 模式自动打开的 DevTools 窗口，等真正的应用窗口 */
async function waitForMainPage(
  application: Awaited<ReturnType<typeof electron.launch>>,
): Promise<Awaited<ReturnType<typeof application.firstWindow>>> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const page = application
      .windows()
      .find((candidate) => !candidate.url().startsWith('devtools://'));
    if (page !== undefined) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('等待应用主窗口超时');
}

let app: Awaited<ReturnType<typeof electron.launch>> | null = null;
let passed = false;
try {
  app = await electron.launch({ args: [mainEntry], env: launchEnv });
  const page = await waitForMainPage(app);

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (counts.traces > 0 && counts.metrics > 0 && counts.logs > 0) {
      passed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(
    `[observability-smoke] traces=${counts.traces} metrics=${counts.metrics} logs=${counts.logs} endpoint=${endpoint}`,
  );

  const status = await page.evaluate(async () => window.api.telemetry.getStatus());
  if (!('data' in status) || status.data.otel.enabled !== true) {
    throw new Error(`telemetry:getStatus 未返回预期状态：${JSON.stringify(status)}`);
  }
  const connection = await page.evaluate(async () => window.api.telemetry.testConnection());
  if (!('data' in connection) || connection.data.otlp.reason !== 'probed') {
    throw new Error(`telemetry:testConnection 未返回探测结果：${JSON.stringify(connection)}`);
  }
  console.log('[observability-smoke] 设置页状态/连接测试 IPC 正常');
} catch (error) {
  console.error('[observability-smoke] 启动/采集失败：', error);
} finally {
  if (app !== null) {
    await app.close().catch(() => {});
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

if (!passed) {
  console.error('[observability-smoke] ❌ 25s 内未收到三类 OTLP 信号');
  process.exit(1);
}
console.log('[observability-smoke] ✅ traces/metrics/logs 均已到达');
