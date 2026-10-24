import { PRODUCT_NAME } from '@code-agent/shared/main';
import { type Context, context, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { recordStartupPhase } from './otel-metrics';

type StartupPhase = 'services' | 'window' | 'ready-to-show' | 'renderer-ready';
type StartupMode = 'foreground' | 'hidden';

interface StartupObservation {
  readonly span: Span;
  readonly context: Context;
  readonly startedAt: number;
  readonly mode: StartupMode;
  readonly phases: Set<StartupPhase>;
  readonly timer: ReturnType<typeof setTimeout>;
  senderId: number | null;
}

let observation: StartupObservation | null = null;

/** 结束未完成的启动观测，不等待窗口或渲染进程。 */
export function stopStartupObservation(reason = 'shutdown-before-ready'): void {
  const current = observation;
  if (current === null) return;
  observation = null;
  clearTimeout(current.timer);
  current.span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
  current.span.end();
}

/** 启动根 span 持续至主窗口可显示且初始路由已挂载；不阻塞应用初始化。 */
export async function withStartupObservation<T>(
  startedAt: number,
  mode: StartupMode,
  fn: () => Promise<T>,
): Promise<T> {
  stopStartupObservation('startup-replaced');
  const span = trace.getTracer(PRODUCT_NAME).startSpan('app.startup', {
    startTime: performance.timeOrigin + startedAt,
    attributes: { 'startup.mode': mode },
  });
  const activeContext = trace.setSpan(context.active(), span);
  const timer = setTimeout(() => stopStartupObservation('startup-timeout'), 30_000);
  timer.unref();
  observation = {
    span,
    context: activeContext,
    startedAt,
    mode,
    timer,
    senderId: null,
    phases: new Set(),
  };
  try {
    return await context.with(activeContext, fn);
  } catch (error) {
    stopStartupObservation('startup-failed');
    throw error;
  }
}

/** 只绑定首次主窗口，重载或后续窗口不重复计入启动。 */
export function bindStartupWindow(senderId: number): void {
  if (observation !== null && observation.senderId === null) {
    observation.senderId = senderId;
  }
}

/** 每个里程碑只记录一次，耗时均相对同一个进程启动时钟。 */
export function recordStartupMilestone(phase: StartupPhase): void {
  const current = observation;
  if (current === null || current.phases.has(phase)) return;
  current.phases.add(phase);
  context.with(current.context, () => {
    recordStartupPhase(phase, performance.now() - current.startedAt, current.mode);
    current.span.addEvent(phase);
  });
  if (current.phases.has('renderer-ready') && current.phases.has('ready-to-show')) {
    observation = null;
    clearTimeout(current.timer);
    current.span.setStatus({ code: SpanStatusCode.OK });
    current.span.end();
  }
}

/** 只接受当前启动主窗口的就绪通知。 */
export function recordStartupReady(
  senderId: number,
  phase: 'renderer-ready' | 'ready-to-show',
): boolean {
  if (observation === null || observation.senderId !== senderId || observation.phases.has(phase)) {
    return false;
  }
  recordStartupMilestone(phase);
  return true;
}
