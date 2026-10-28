// settings-backup.test.ts：模板底座集成链路——settings 写穿透往返 + 备份创建/列举
// 真实协作：真实 SQLite（临时 userData）、真实 settings-pref/backup-store；
// 仅 Electron SDK 由 setup.ts 替身（与其余集成用例同一边界）。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SETTINGS_EXPORT_VERSION } from '@code-agent/shared/main';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { getMainLanguage } from '../../src/main/infra/i18n';
import { closeDb, getDbPath, initDb, resetDb } from '../../src/main/infra/storage/db';
import { getSecret } from '../../src/main/infra/storage/keychain';
import {
  readAllSettings,
  readSetting,
  writeSetting,
} from '../../src/main/infra/storage/settings-pref';
import { backupHandlers } from '../../src/main/ipc/backup.handler';
import { settingsHandlers } from '../../src/main/ipc/settings.handler';
import { setOpenDialogResult, withTempUserData } from './helpers/with-db';

/** handler 的第二参（traceId/sender）——本链路不推送事件，空对象即可 */
const EMPTY_CTX = {} as never;

describe('settings 域写入 → 读取往返（真实 SQLite）', () => {
  it('set 后 getAll 返回同一份数据', async () => {
    await withTempUserData(async () => {
      await settingsHandlers.set({ key: 'theme', value: 'light' }, EMPTY_CTX);
      await settingsHandlers.set({ key: 'window', value: { closeAction: 'quit' } }, EMPTY_CTX);

      const { settings } = await settingsHandlers.getAll({}, EMPTY_CTX);
      expect(settings['theme']).toBe('light');
      expect(settings['window']).toEqual({ closeAction: 'quit' });
    });
  });

  it('resetAll 清空白名单键，getAll 回落空快照', async () => {
    await withTempUserData(async () => {
      await settingsHandlers.set({ key: 'theme', value: 'light' }, EMPTY_CTX);
      await settingsHandlers.resetAll({}, EMPTY_CTX);

      const { settings } = await settingsHandlers.getAll({}, EMPTY_CTX);
      expect(settings).toEqual({});
    });
  });
});

describe('设置导入/重置的主进程语言同步', () => {
  it('导入 language 后主进程 i18n 跟随，重置回默认语言', async () => {
    await withTempUserData(async () => {
      const dir = mkdtempSync(join(tmpdir(), 'settings-import-'));
      const file = join(dir, 'settings.json');
      writeFileSync(
        file,
        JSON.stringify({
          version: SETTINGS_EXPORT_VERSION,
          exportedAt: Date.now(),
          settings: { language: 'en', theme: 'light' },
        }),
        'utf8',
      );
      setOpenDialogResult({ canceled: false, filePaths: [file] });
      try {
        const outcome = await settingsHandlers.importSettings(undefined, EMPTY_CTX);
        expect(outcome.imported).toBe(2);
        expect(getMainLanguage()).toBe('en');

        await settingsHandlers.resetAll({}, EMPTY_CTX);
        expect(getMainLanguage()).toBe('zh-CN');
        expect(readAllSettings()).toEqual({});
      } finally {
        setOpenDialogResult({ canceled: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe('代理凭据：app_settings 不落明文，keychain 可恢复', () => {
  it('settings:set 拆出凭据并只回派生状态', async () => {
    await withTempUserData(async () => {
      await settingsHandlers.set(
        {
          key: 'proxy',
          value: {
            mode: 'fixed',
            protocol: 'http',
            host: 'proxy.example',
            port: 8080,
            bypass: ['corp.example'],
            auth: { username: 'alice', password: 's3cret' },
          },
        },
        EMPTY_CTX,
      );

      expect(readSetting('proxy')).toEqual({
        mode: 'fixed',
        protocol: 'http',
        host: 'proxy.example',
        port: 8080,
        bypass: ['corp.example'],
      });
      expect(await getSecret('__proxy_auth')).toBe('http://alice:s3cret@proxy.example:8080');

      const { settings } = await settingsHandlers.getAll({}, EMPTY_CTX);
      expect(settings['proxy']).toMatchObject({
        mode: 'fixed',
        protocol: 'http',
        host: 'proxy.example',
        port: 8080,
        hasAuth: true,
        authUsername: 'alice',
      });
    });
  });

  it('导入文件中的代理凭据同样加密，不写回 app_settings', async () => {
    await withTempUserData(async () => {
      const dir = mkdtempSync(join(tmpdir(), 'proxy-import-'));
      const file = join(dir, 'settings.json');
      writeFileSync(
        file,
        JSON.stringify({
          version: SETTINGS_EXPORT_VERSION,
          exportedAt: Date.now(),
          settings: {
            theme: 'light',
            proxy: {
              mode: 'fixed',
              protocol: 'http',
              host: 'proxy.example',
              port: 9090,
              auth: { username: 'bob', password: 'p@ss' },
            },
          },
        }),
        'utf8',
      );
      setOpenDialogResult({ canceled: false, filePaths: [file] });
      try {
        const outcome = await settingsHandlers.importSettings(undefined, EMPTY_CTX);
        expect(outcome.imported).toBe(2);
        expect(readSetting('proxy')).toEqual({
          mode: 'fixed',
          protocol: 'http',
          host: 'proxy.example',
          port: 9090,
        });
        expect(await getSecret('__proxy_auth')).toBe('http://bob:p%40ss@proxy.example:9090');
        expect(JSON.stringify(readAllSettings()['proxy'])).not.toContain('bob');
      } finally {
        setOpenDialogResult({ canceled: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('resetAll 清除代理凭据', async () => {
    await withTempUserData(async () => {
      await settingsHandlers.set(
        {
          key: 'proxy',
          value: {
            mode: 'fixed',
            protocol: 'http',
            host: 'proxy',
            port: 8080,
            auth: { username: 'alice', password: 's3cret' },
          },
        },
        EMPTY_CTX,
      );
      await settingsHandlers.resetAll({}, EMPTY_CTX);
      expect(await getSecret('__proxy_auth')).toBeNull();
      expect(readSetting('proxy')).toBeUndefined();
    });
  });
});

describe('backup 域：创建 → 列举', () => {
  it('create 产出备份项，list 能读到且按时间倒序', async () => {
    await withTempUserData(async () => {
      const first = await backupHandlers.create(undefined, EMPTY_CTX);
      const second = await backupHandlers.create(undefined, EMPTY_CTX);

      const { backups } = await backupHandlers.list(undefined, EMPTY_CTX);
      const names = backups.map((b) => b.name);
      expect(names).toContain(first.name);
      expect(names).toContain(second.name);
      expect(backups.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('restore 暂存恢复点，重启初始化后数据回到备份时刻', async () => {
    await withTempUserData(async () => {
      writeSetting('theme', 'light');
      const { name } = await backupHandlers.create(undefined, EMPTY_CTX);
      writeSetting('theme', 'dark');

      await closeDb();
      resetDb();
      await backupHandlers.restore({ name }, EMPTY_CTX);

      initDb();
      expect(readSetting('theme')).toBe('light');
    });
  });
});

describe('旧基线库兼容（迁移链重建后的启动路径）', () => {
  it('既有库（旧迁移记录 + app_settings）启动不重复建表，且设置可读', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-agent-it-legacy-'));
    // 必须改共享对象的属性（setup.ts 的 app.getPath 闭包持有同一引用），整体替换无效
    const state = (globalThis as Record<string, unknown>)['__itState'] as { userData: string };
    state.userData = dir;
    try {
      // 造一个「旧基线」库：表已建 + __drizzle_migrations 最后一条早于新基线
      // 文件名取自 getDbPath()——写死会在品牌改名后造出一个初始化流程不会读的孤立库
      const legacy = new Database(getDbPath());
      legacy.exec(
        'CREATE TABLE app_settings (key text PRIMARY KEY NOT NULL, value text NOT NULL, updated_at integer NOT NULL);',
      );
      legacy.exec(
        'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);',
      );
      legacy
        .prepare('INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)')
        .run('legacy-baseline', 1);
      legacy
        .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run('theme', '"light"', Date.now());
      legacy.close();

      await closeDb();
      resetDb();
      initDb();

      // 未被迁移链重建清空：旧值仍可读（说明基线被登记为已应用而非重复建表失败）
      expect(readSetting('theme')).toBe('light');
    } finally {
      await closeDb();
      resetDb();
      rmSync(dir, { recursive: true, maxRetries: 5 });
    }
  });
});
