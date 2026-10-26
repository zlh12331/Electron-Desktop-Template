// session-hardening.ts：session 级安全收口——CSP/XFO 注入 + 权限白名单。
// defaultSession 与未来每个 WebContentsView 的独立 partition 都必须调用本函数；
// 只在 defaultSession 上挂 handler 会让新 partition 绕开权限策略（Electron 默认会批准权限）。
import type { Session } from 'electron';
import { logger } from '../utils/logger';
import { applyCspToSession } from './csp';
import { isAllowedRendererPermission } from './permissions';

/**
 * 给一个 session 应用 CSP/XFO 与权限白名单
 *
 * @param session 目标 session（defaultSession 或 WebContentsView 的 partition session）
 * @param isDev dev 环境放宽 CSP；打包态使用严格策略
 */
export function hardenSession(session: Session, isDev: boolean): void {
  applyCspToSession(session, isDev);

  // 权限收口双保险：request handler 拒绝申请，check handler 拒绝查询/隐式授予。
  // 仅剪贴板写放行（复制按钮依赖），读取类权限继续全拒绝。
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = isAllowedRendererPermission(permission);
    if (!allowed) {
      logger.warn(
        { permission, url: webContents.getURL() },
        '拒绝渲染层权限请求（未授权权限类型）',
      );
    }
    callback(allowed);
  });
  session.setPermissionCheckHandler((_webContents, permission) =>
    isAllowedRendererPermission(permission),
  );
}
