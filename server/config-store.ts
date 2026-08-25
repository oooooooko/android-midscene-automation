import type { AppConfig } from './config';
import { querySql, runSql, sqlString } from './storage/sqlite';

export type AppPresetRecord = {
  id: string;
  name: string;
  packageName: string;
  createdAt: string;
  updatedAt: string;
};

type AppPresetRow = {
  id: string;
  name: string;
  package_name: string;
  created_at: string;
  updated_at: string;
};

let initialized = false;

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToAppPreset(row: AppPresetRow): AppPresetRecord {
  return {
    id: row.id,
    name: row.name,
    packageName: row.package_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function initConfigDb() {
  if (initialized) return;
  initialized = true;
  runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      package_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name, package_name)
    );
    CREATE INDEX IF NOT EXISTS idx_app_presets_updated_at ON app_presets(updated_at DESC);
  `);
}

export function loadModelConfigFromDb() {
  initConfigDb();
  const row = querySql<{ value_json: string }>(`
    SELECT value_json
    FROM app_config
    WHERE key = 'model_config'
    LIMIT 1;
  `)[0];

  return row ? JSON.parse(row.value_json) as Partial<AppConfig> : null;
}

export function saveModelConfigToDb(config: AppConfig) {
  initConfigDb();
  const now = new Date().toISOString();
  runSql(`
    INSERT INTO app_config (key, value_json, updated_at)
    VALUES ('model_config', ${sqlString(JSON.stringify(config))}, ${sqlString(now)})
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at;
  `);
}

export function listAppPresetRecords() {
  initConfigDb();
  return querySql<AppPresetRow>(`
    SELECT id, name, package_name, created_at, updated_at
    FROM app_presets
    ORDER BY updated_at DESC;
  `).map(rowToAppPreset);
}

export function saveAppPresetRecord(input: { id?: string; name: string; packageName: string }) {
  initConfigDb();
  const now = new Date().toISOString();
  const name = input.name.trim();
  const packageName = input.packageName.trim();

  if (!name) throw new Error('App 名称不能为空');
  if (!packageName) throw new Error('App 包名不能为空');

  const existing = querySql<{ id: string }>(`
    SELECT id
    FROM app_presets
    WHERE name = ${sqlString(name)}
      AND package_name = ${sqlString(packageName)}
    LIMIT 1;
  `)[0];

  if (existing && existing.id !== input.id) {
    throw new Error('已存在相同 App 名称和包名的配置');
  }

  const id = input.id || createId();

  runSql(`
    INSERT INTO app_presets (id, name, package_name, created_at, updated_at)
    VALUES (${sqlString(id)}, ${sqlString(name)}, ${sqlString(packageName)}, ${sqlString(now)}, ${sqlString(now)})
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      package_name = excluded.package_name,
      updated_at = excluded.updated_at;
  `);

  const row = querySql<AppPresetRow>(`
    SELECT id, name, package_name, created_at, updated_at
    FROM app_presets
    WHERE id = ${sqlString(id)}
    LIMIT 1;
  `)[0];

  return rowToAppPreset(row);
}

export function removeAppPresetRecord(id: string) {
  initConfigDb();
  runSql(`DELETE FROM app_presets WHERE id = ${sqlString(id)};`);
  return { success: true };
}
