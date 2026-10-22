// file-permissions.ts：文件权限收紧（unix 0600 / win32 ACL）——凭据文件与数据库共用。
// win32 用 icacls 断继承 + 仅授予当前用户；DPAPI / 数据库加密才是主防线，ACL 是纵深防御，
// 失败只告警不阻塞。whoami 解析不到账户时跳过（不炸调用方）。
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from './logger';

/** 解析当前 Windows 账户（whoami 失败返回空串） */
function resolveWindowsAccount(): string {
  const systemRoot = process.env['SystemRoot'];
  const whoamiExe =
    systemRoot !== undefined ? join(systemRoot, 'System32', 'whoami.exe') : 'whoami';
  try {
    return execFileSync(whoamiExe, [], { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return '';
  }
}

/**
 * 收紧单个文件的访问权限：unix 0600；win32 断继承并只授予当前用户。
 *
 * @param filePath 目标文件绝对路径（须已存在）
 */
export function restrictFilePermissions(filePath: string): void {
  if (process.platform !== 'win32') {
    try {
      chmodSync(filePath, 0o600);
    } catch {}
    return;
  }
  const user = resolveWindowsAccount();
  if (user.length === 0) {
    logger.warn({ filePath }, '文件 ACL 收紧跳过（whoami 未解析到账户）');
    return;
  }
  try {
    const systemRoot = process.env['SystemRoot'];
    const icaclsExe =
      systemRoot !== undefined ? join(systemRoot, 'System32', 'icacls.exe') : 'icacls';
    execFileSync(icaclsExe, [filePath, '/inheritance:r', '/grant:r', `${user}:F`], {
      stdio: 'ignore',
    });
  } catch {
    logger.warn({ filePath }, '文件 ACL 收紧失败（加密/DPAPI 仍为主防线）');
  }
}
