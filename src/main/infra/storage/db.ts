// db.ts：SQLite 连接初始化 + 启动备份 + 损坏自愈——better-sqlite3 承载 Drizzle ORM
// 启动序：应用暂存恢复 → 打开/自愈（quick_check → 备份回滚 → 归档重建）→ pragma → 迁移 → 调度启动备份
// 边界：schema 真源在 schema.ts，迁移文件由 drizzle-kit 从其派生，本文件不写任何建表 SQL
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EXECUTABLE_NAME } from '@code-agent/shared/main';
import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { app } from 'electron';
import { reportError } from '../../utils/error-report';
import { restrictFilePermissions } from '../../utils/file-permissions';
import { logger } from '../../utils/logger';
import { recordDbBackup, recordDbRecovery } from '../telemetry/otel-metrics';
import {
  applyPendingRestore,
  backupDirPath,
  cleanupBackupTmpFiles,
  createBackupFile,
  isBackupHealthy,
  listBackupNames,
} from './backup-store';
import { schema } from './schema';

const DB_FILENAME = `${EXECUTABLE_NAME}.db`;
// SQLite pragma 值：2 = INCREMENTAL（自动空间回收不开全库 VACUUM）
const AUTO_VACUUM_INCREMENTAL = 2;

// 备份串行化：better-sqlite3 的 backup() 是异步 API，并发备份会互相踩——
// 已有 pending 时链在其后执行，全程只保留一条备份链尾
function runBackup(sqlite: Database.Database, dbPath: string): Promise<void> {
  const run = (): Promise<void> => {
    const startedAt = performance.now();
    return createBackupFile(sqlite, dbPath)
      .then(() => {
        recordDbBackup('success', performance.now() - startedAt);
      })
      .catch((error: unknown) => {
        cleanupBackupTmpFiles(dbPath);
        recordDbBackup('error', performance.now() - startedAt);
        reportError(error, {
          message: '数据库备份失败',
          fields: { dbPath },
          tags: { scope: 'db', stage: 'backup' },
        });
      });
  };
  const task = pendingBackup !== null ? pendingBackup.then(run, run) : run();
  pendingBackup = task;
  return task;
}

/** 手动备份（设置面触发）：先排干挂起备份再执行，防并发 */
export async function createManualBackup(): Promise<{ readonly name: string }> {
  if (pendingBackup !== null) {
    await pendingBackup;
  }
  if (sqliteInstance === null) {
    throw new Error('数据库未初始化，无法备份');
  }
  const dbPath = getDbPath();
  const startedAt = performance.now();
  try {
    const name = await createBackupFile(sqliteInstance, dbPath);
    recordDbBackup('success', performance.now() - startedAt);
    return { name };
  } catch (error) {
    recordDbBackup('error', performance.now() - startedAt);
    throw error;
  }
}

// 重建分支跳过启动备份：空库若进备份轮转，会把仅有的健康备份挤掉——保留它们等下次真实数据
function scheduleStartupBackup(
  sqlite: Database.Database,
  dbPath: string,
  status: RecoveryStatus,
): void {
  if (status === 'rebuilt') {
    logger.warn({}, '本次启动重建了空数据库，跳过启动备份以保留既有健康备份');
    return;
  }
  void runBackup(sqlite, dbPath);
}

// 从最新到最旧逐个尝试恢复：候选须过完整性校验；替换前先清 db/-wal/-shm 三件套
//（旧 wal 与恢复后的主库不匹配会再次损坏）
function tryRestoreFromBackup(dbPath: string): boolean {
  const backupDir = backupDirPath(dbPath);
  const backups = listBackupNames(dbPath);
  if (backups.length === 0) {
    return false;
  }
  for (const name of [...backups].reverse()) {
    const candidate = join(backupDir, name);
    try {
      if (!isBackupHealthy(candidate)) {
        logger.warn({ backup: name }, '备份完整性校验失败，尝试更早备份');
        continue;
      }
      for (const suffix of ['', '-wal', '-shm'] as const) {
        try {
          rmSync(`${dbPath}${suffix}`, { force: true });
        } catch {}
      }
      copyFileSync(candidate, dbPath);
      restrictFilePermissions(dbPath);
      logger.warn({ from: candidate }, '已从备份恢复数据库文件');
      return true;
    } catch (error) {
      logger.warn(
        { backup: name, error: error instanceof Error ? error.message : String(error) },
        '备份恢复尝试失败',
      );
    }
  }
  return false;
}

/** 自愈结局：healthy=原库无恙 / restored=备份恢复 / rebuilt=归档后重建空库（迁移随后建表） */
type RecoveryStatus = 'healthy' | 'restored' | 'rebuilt';

interface RecoveryOutcome {
  readonly sqlite: Database.Database;
  readonly status: RecoveryStatus;
}

// 损坏自愈三级：quick_check 健康即用 → 从备份恢复 → 无备份则归档损坏文件（.corrupt-时间戳）
// 后重建空库（数据不静默丢弃，归档可人工找回）
function restoreCorruptDatabase(sqlite: Database.Database | null, dbPath: string): RecoveryOutcome {
  if (sqlite !== null) {
    let integrity: unknown;
    try {
      integrity = sqlite.pragma('quick_check', { simple: true }) as unknown;
    } catch (error) {
      integrity = error instanceof Error ? error.message : String(error);
    }
    const healthy = !(typeof integrity === 'string' && integrity !== 'ok');
    if (healthy) {
      logger.info({}, 'SQLite 完整性校验通过');
      recordDbRecovery('healthy');
      return { sqlite, status: 'healthy' };
    }
    reportError(new Error(`SQLite 完整性校验失败：${String(integrity)}`), {
      message: 'SQLite 完整性校验失败，进入损坏自愈流程',
      fields: { dbPath, result: integrity },
      tags: { scope: 'db', stage: 'integrity' },
    });
    try {
      sqlite.close();
    } catch {}
  }

  // sqlite=null 表示打开阶段已失败：openWithDefaultPragmas 已上报具体错误，这里直接进入备份恢复/重建
  if (tryRestoreFromBackup(dbPath)) {
    const reopened = new Database(dbPath);
    applyDefaultPragmas(reopened, dbPath);
    recordDbRecovery('restored');
    return { sqlite: reopened, status: 'restored' };
  }

  const corruptPath = `${dbPath}.corrupt-${Date.now()}`;
  try {
    renameSync(dbPath, corruptPath);
    logger.error({ corruptPath }, '数据库损坏且无可用备份，已归档损坏文件');
  } catch (error) {
    reportError(error, {
      message: '损坏数据库归档失败，直接重建',
      fields: { dbPath, corruptPath },
      tags: { scope: 'db', stage: 'archive' },
    });
  }
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {}
  }
  const fresh = new Database(dbPath);
  restrictFilePermissions(dbPath);
  applyDefaultPragmas(fresh, dbPath);
  logger.warn({}, '已重建空数据库（前提数据已归档，后续迁移建表）');
  recordDbRecovery('rebuilt');
  return { sqlite: fresh, status: 'rebuilt' };
}

// 标准档 pragma：WAL（读写并发）+ 外键强制 + 3s busy 等待（并发写偶发锁）+ NORMAL 同步
//（WAL 下 NORMAL 已足够安全且快）；wal/shm 文件权限同步收紧
function applyDefaultPragmas(sqlite: Database.Database, dbPath: string): void {
  sqlite.pragma('journal_mode = WAL');
  restrictFilePermissions(`${dbPath}-wal`);
  restrictFilePermissions(`${dbPath}-shm`);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 3000');
  sqlite.pragma('synchronous = NORMAL');
}

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, DB_FILENAME);
}

/** Drizzle 数据库实例类型（集成测试 helper 取用；本文件其余位置不再重复声明） */
export type DrizzleDB = BetterSQLite3Database<typeof schema>;

let dbInstance: DrizzleDB | null = null;

let sqliteInstance: Database.Database | null = null;

let pendingBackup: Promise<void> | null = null;

/**
 * 旧基线库重挂：模板把迁移链重建为单条基线后，既有库（含旧迁移记录且已建 app_settings）
 * 会让 drizzle 误判基线未应用而重复建表。drizzle 只比较 __drizzle_migrations.created_at
 * 与迁移的 folderMillis，不校验 hash——因此按「库中已有该表」的客观事实，把新基线
 * 直接登记为已应用。
 *
 * 边界：只处理「最后一条记录早于新基线 + app_settings 已存在」的旧库；全新库与
 * 已在新链上的库都不受影响。
 */
function rebaseLegacyMigrationBaseline(sqlite: Database.Database, migrationsDir: string): void {
  const migrationsTable = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (migrationsTable === undefined) {
    return;
  }

  const last = sqlite
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    // biome-ignore lint/style/useNamingConvention: better-sqlite3 返回行保持 SQL 列名
    .get() as { created_at: number } | undefined;
  if (last === undefined) {
    return;
  }

  let firstBaselineAt: unknown;
  try {
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries?: Array<{ when?: unknown }> };
    firstBaselineAt = journal.entries?.[0]?.when;
  } catch {
    return;
  }
  if (typeof firstBaselineAt !== 'number' || Number(last.created_at) >= firstBaselineAt) {
    return;
  }

  const settingsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'")
    .get();
  if (settingsTable === undefined) {
    return;
  }

  sqlite
    .prepare('INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)')
    .run('legacy-baseline-rebase', firstBaselineAt);
  logger.warn(
    { lastMigrationAt: Number(last.created_at), baselineAt: firstBaselineAt },
    '检测到旧基线数据库：新迁移基线已登记为已应用（避免重复建表）',
  );
}

// 迁移目录三候选：打包态在 resources（extraResources）；dev 因 pnpm 启动 cwd 不定，
// 依次试 appPath/cwd/上两级，以 meta/_journal.json 存在为准
function resolveMigrationsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'drizzle');
  }
  const candidates = [
    join(app.getAppPath(), 'drizzle'),
    join(process.cwd(), 'drizzle'),
    join(app.getAppPath(), '..', '..', 'drizzle'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'meta', '_journal.json'))) {
      return dir;
    }
  }
  return candidates[0] as string;
}

// 打开即配好 pragma 并收紧权限；打开阶段失败返回 null 交给自愈流程（而非直接炸启动）
function openWithDefaultPragmas(dbPath: string): Database.Database | null {
  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(dbPath);
    restrictFilePermissions(dbPath);
    applyDefaultPragmas(sqlite, dbPath);
    return sqlite;
  } catch (openError: unknown) {
    reportError(openError, {
      message: '数据库打开/pragma 失败，转入损坏自愈流程',
      fields: { dbPath },
      tags: { scope: 'db', stage: 'open' },
    });
    try {
      sqlite?.close();
    } catch {}
    return null;
  }
}

/**
 * 初始化数据库（应用级单例，whenReady 启动序列调用）：
 * 暂存恢复 → 损坏自愈 → auto_vacuum 对齐 → 极老库补丁 → 迁移 → 调度启动备份
 */
export function initDb(): DrizzleDB {
  if (dbInstance !== null) {
    return dbInstance;
  }

  const dbPath = getDbPath();
  const dir = join(dbPath, '..');
  mkdirSync(dir, { recursive: true });

  logger.info({ dbPath }, '初始化 SQLite 数据库');

  try {
    applyPendingRestore(dbPath);
  } catch (error) {
    reportError(error, {
      message: '备份恢复应用失败（暂存保留，下次启动重试；继续按现有库启动）',
      fields: { dbPath },
      tags: { scope: 'db', stage: 'restore' },
    });
  }

  const recovery = restoreCorruptDatabase(openWithDefaultPragmas(dbPath), dbPath);
  const sqlite = recovery.sqlite;
  ensureIncrementalAutoVacuum(sqlite);

  const db = drizzle(sqlite, { schema });

  const migrationsDir = resolveMigrationsDir();
  rebaseLegacyMigrationBaseline(sqlite, migrationsDir);
  try {
    migrate(db, { migrationsFolder: migrationsDir });
    logger.info({ migrationsDir }, 'SQLite 迁移已应用');
  } catch (error) {
    reportError(error, {
      message: 'SQLite 迁移执行失败（迁移目录缺失或损坏）',
      fields: { migrationsDir, dbPath },
      tags: { scope: 'db', stage: 'migration' },
    });
    try {
      sqlite.close();
    } catch {}
    throw error;
  }

  scheduleStartupBackup(sqlite, dbPath, recovery.status);

  dbInstance = db;
  sqliteInstance = sqlite;
  logger.info({ dbPath }, 'SQLite 数据库初始化完成');
  return db;
}

/** 取 Drizzle 实例（未初始化即抛——调用时序错误要炸得早） */
export function getDb(): DrizzleDB {
  if (dbInstance === null) {
    throw new Error('数据库未初始化，请先调用 initDb()');
  }
  return dbInstance;
}

// auto_vacuum 模式切换必须伴一次全量 VACUUM 才生效（SQLite 限制）——旧库首次升级时一次性执行
function ensureIncrementalAutoVacuum(sqlite: Database.Database): void {
  const current = Number(sqlite.pragma('auto_vacuum', { simple: true }));
  if (current === AUTO_VACUUM_INCREMENTAL) {
    return;
  }
  const startedAt = Date.now();
  sqlite.pragma('auto_vacuum = INCREMENTAL');
  sqlite.exec('VACUUM');
  logger.info(
    { from: current, ms: Date.now() - startedAt },
    'SQLite auto_vacuum 已转换为 INCREMENTAL（一次性）',
  );
}

/** 等待挂起的启动备份完成（退出链 closeDb 前调用，防备份写一半进程就没了） */
async function drainPendingBackups(): Promise<void> {
  const tail = pendingBackup;
  if (tail !== null) {
    await tail;
    if (pendingBackup === tail) {
      pendingBackup = null;
    }
  }
}

/** 优雅关闭：排干备份 → 关连接（dispose 链最后一步，DB 必须最后关） */
export async function closeDb(): Promise<void> {
  await drainPendingBackups();
  if (sqliteInstance !== null) {
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
    logger.info({}, 'SQLite 数据库连接已关闭');
  }
}

/** 仅清单例引用不关连接（测试重置用；生产关闭走 closeDb） */
export function resetDb(): void {
  dbInstance = null;
  sqliteInstance = null;
}
