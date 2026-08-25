import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { appDataPath } from '../paths';

const dbPath = appDataPath('.midscene-app', 'script-cache.sqlite');
const require = createRequire(import.meta.url);
let databaseSyncCtor: unknown;

export function getRuntimeDbPath() {
  return dbPath;
}

export function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlNullableString(value: string | null | undefined) {
  return value ? sqlString(value) : 'NULL';
}

export function sqlJson(value: unknown) {
  return sqlString(JSON.stringify(value ?? null));
}

function ensureDbDir() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function getSqliteBin() {
  return process.env.SQLITE3_BIN || (process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3');
}

function getDatabaseSync() {
  if (databaseSyncCtor !== undefined) {
    return databaseSyncCtor as null | { new (filename: string): { exec(sql: string): void; prepare(sql: string): { all(): unknown[] }; close(): void } };
  }

  try {
    databaseSyncCtor = (require('node:sqlite') as {
      DatabaseSync?: { new (filename: string): { exec(sql: string): void; prepare(sql: string): { all(): unknown[] }; close(): void } };
    }).DatabaseSync || null;
  } catch {
    databaseSyncCtor = null;
  }

  return databaseSyncCtor as null | { new (filename: string): { exec(sql: string): void; prepare(sql: string): { all(): unknown[] }; close(): void } };
}

function runWithNodeSqlite<T>(callback: (db: InstanceType<NonNullable<ReturnType<typeof getDatabaseSync>>>) => T) {
  const DatabaseSync = getDatabaseSync();
  if (!DatabaseSync) {
    return null;
  }

  const db = new DatabaseSync(dbPath);
  try {
    return callback(db as InstanceType<NonNullable<ReturnType<typeof getDatabaseSync>>>);
  } finally {
    db.close();
  }
}

function explainSqliteCliError(error: unknown) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error;
  }

  throw new Error(
    `未找到 sqlite3 命令。请安装 sqlite3 并加入 PATH，或通过 SQLITE3_BIN 指定 sqlite3 可执行文件路径。当前尝试执行：${getSqliteBin()}`,
  );
}

// 优先使用 Node 24 内置 sqlite；旧 Node 再回退到 sqlite3 CLI。
export function runSql(sql: string) {
  ensureDbDir();
  const result = runWithNodeSqlite((db) => {
    db.exec(sql);
    return true;
  });
  if (result) return;

  try {
    execFileSync(getSqliteBin(), [dbPath], {
      input: sql,
      maxBuffer: 40 * 1024 * 1024,
    });
  } catch (error) {
    explainSqliteCliError(error);
  }
}

export function querySql<T>(sql: string) {
  ensureDbDir();
  const result = runWithNodeSqlite((db) => db.prepare(sql).all() as T[]);
  if (result) return result;

  try {
    const output = execFileSync(getSqliteBin(), ['-json', dbPath, sql], {
      encoding: 'utf8',
      maxBuffer: 40 * 1024 * 1024,
    });
    return JSON.parse(output || '[]') as T[];
  } catch (error) {
    explainSqliteCliError(error);
  }
}
