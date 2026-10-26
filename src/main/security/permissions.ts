// permissions.ts：渲染层权限白名单——默认拒绝全部，仅放行剪贴板写。
// 复制按钮依赖 navigator.clipboard.writeText，Electron 会以 clipboard-sanitized-write
// 走 permission check/request；若这里继续全拒绝，About 的“复制诊断信息”与
// diagnostics-card 的复制都会以 NotAllowedError 失败（2026-10-26 真实窗口实测）。
// 边界：只放行“写”，clipboard-read 等读取类权限保持拒绝。

/** 唯一放行的渲染层权限：剪贴板写（sanitized 指写入内容经过浏览器净化） */
export const CLIPBOARD_WRITE_PERMISSION = 'clipboard-sanitized-write';

/**
 * 判断渲染层权限是否在白名单内
 *
 * @param permission Electron permission 名称
 * @returns true 仅当权限为剪贴板写
 */
export function isAllowedRendererPermission(permission: string): boolean {
  return permission === CLIPBOARD_WRITE_PERMISSION;
}
