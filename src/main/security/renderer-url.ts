// renderer-url.ts：渲染层入口 URL 的精确白名单——主窗口导航与 IPC sender 共用同一判据。
// 边界：只做 URL 策略，不读 Electron 窗口；产物入口由 app.getAppPath() 推导。
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 产物渲染层入口的 file URL
 *
 * @param appPath Electron app.getAppPath()（打包态为 app.asar，dev 为仓库根）
 * @returns out/renderer/index.html 的绝对 file URL
 */
export function rendererEntryFileUrl(appPath: string): string {
  return pathToFileURL(join(appPath, 'out', 'renderer', 'index.html')).href;
}

/**
 * 是否允许渲染层入口 URL
 *
 * file: 路径 + host 必须等于产物入口，query 拒绝；**hash 允许**——
 * 生产构建用 hash router（file:// 下 history 路由不可用），hash 不改变
 * 实际加载的资源，拒绝它会让 About 等路由的所有 IPC 被 sender 校验误杀。
 * dev 只接受 dev server origin（路径/query/hash 均可，保留 Vite 与 hash 路由）。
 *
 * @param rawUrl 待校验 URL
 * @param entryFileUrl 产物入口 file URL（rendererEntryFileUrl 的返回值）
 * @param devServerUrl dev server URL（未配置时只允许 file 入口）
 */
export function isAllowedRendererUrl(
  rawUrl: string,
  entryFileUrl: string,
  devServerUrl?: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === 'file:') {
    const entry = new URL(entryFileUrl);
    return parsed.host === entry.host && parsed.pathname === entry.pathname && parsed.search === '';
  }
  if (devServerUrl !== undefined && devServerUrl.length > 0) {
    try {
      return parsed.origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 是否为可交系统浏览器打开的 http(s) URL
 *
 * @param rawUrl 待校验 URL
 */
export function isHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
