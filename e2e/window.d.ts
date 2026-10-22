// e2e/window.d.ts：E2E 用例里 page.evaluate 回调的浏览器全局补充。
// 渲染层自身的 window.api 声明在 packages/shared/src/ipc/api.ts；E2E 不 import 渲染层源码，
// 故在此引入同一类型，避免在用例里用 any 绕过。
import type { IpcApi } from '@code-agent/shared/renderer';

declare global {
  interface Window {
    api: IpcApi;
    /** React DevTools 扩展注入的全局钩子（扩展未装时不存在） */
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
      renderers?: Map<unknown, unknown>;
    };
  }
}
