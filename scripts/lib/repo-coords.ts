// repo-coords.ts：发版门禁脚本的仓库坐标解析——CI 取 GITHUB_REPOSITORY，
// 本地回落到品牌真源 app.config.json（派生项目改真源即生效，无需改脚本）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** 解析当前仓库 slug（owner/repo） */
export function resolveRepoSlug(): string {
  const fromEnv = process.env['GITHUB_REPOSITORY'];
  if (fromEnv !== undefined && /^[^/\s]+\/[^/\s]+$/.test(fromEnv)) {
    return fromEnv;
  }
  const brand = JSON.parse(readFileSync(join(ROOT, 'app.config.json'), 'utf8')) as {
    repo: { owner: string; name: string };
  };
  return `${brand.repo.owner}/${brand.repo.name}`;
}
