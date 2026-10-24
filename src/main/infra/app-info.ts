// app-info.ts：构建信息读取（打包时注入的 resources/build-info.json）
// 消费方：app:getInfo、OTel resource、Sentry initialScope；读取失败回退 dev，不抛错
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/** build-info.json 的运行时形状（字段可选，容忍旧产物） */
export interface BuildInfo {
  readonly version?: string;
  readonly channel?: string;
  readonly commitSha?: string;
  readonly buildTime?: string;
}

/** 读取构建信息；打包版读 resources，dev 读仓库 resources；都读不到返回 channel=dev */
export function readBuildInfo(): BuildInfo {
  try {
    const candidates = app.isPackaged
      ? [join(process.resourcesPath, 'build-info.json')]
      : [join(app.getAppPath(), 'resources', 'build-info.json')];
    for (const file of candidates) {
      const data = readFileSync(file, 'utf-8');
      const parsed = JSON.parse(data) as BuildInfo;
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    }
  } catch {}
  return { channel: 'dev' };
}
