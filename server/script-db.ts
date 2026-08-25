import fs from 'node:fs';
import { appPath } from './paths';
import { appDataPath } from './paths';
import { querySql, runSql, sqlString, sqlJson } from './storage/sqlite';

export type ScriptStepRecord = {
  id?: string;
  type: string;
  label: string;
  prompt: string;
  outputVar?: string;
  value?: string;
  observePrompt?: string;
  repeat?: number;
  enabled?: boolean;
};

export type ScriptRecord = {
  id: string;
  name: string;
  promptTitle: string;
  sourcePrompt: string;
  code: string;
  filePath: string;
  steps: ScriptStepRecord[];
  createdAt: string;
  updatedAt: string;
};

type ScriptRow = {
  id: string;
  name: string;
  prompt_title: string;
  source_prompt: string;
  code: string;
  file_path: string;
  steps_json: string;
  created_at: string;
  updated_at: string;
};

const dbPath = appDataPath('.midscene-app', 'script-cache.sqlite');
const legacyJsonPath = appDataPath('midscene_run', 'script-db.json');
let initialized = false;

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToRecord(row: ScriptRow): ScriptRecord {
  return {
    id: row.id,
    name: row.name,
    promptTitle: row.prompt_title,
    sourcePrompt: row.source_prompt,
    code: row.code,
    filePath: row.file_path,
    steps: JSON.parse(row.steps_json || '[]') as ScriptStepRecord[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function migrateLegacyJson() {
  if (!fs.existsSync(legacyJsonPath)) {
    return;
  }

  const count = querySql<{ count: number }>('SELECT COUNT(*) AS count FROM scripts;')[0]?.count || 0;
  if (count > 0) {
    return;
  }

  const parsed = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8')) as {
    scripts?: ScriptRecord[];
  };
  const scripts = Array.isArray(parsed.scripts) ? parsed.scripts : [];

  for (const script of scripts) {
    upsertScriptRecord({
      name: script.name,
      promptTitle: script.promptTitle,
      sourcePrompt: script.sourcePrompt,
      code: script.code,
      filePath: script.filePath,
      steps: script.steps,
    });
  }
}

function initDb() {
  if (initialized) return;
  initialized = true;
  runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      prompt_title TEXT NOT NULL,
      source_prompt TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL,
      file_path TEXT NOT NULL,
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scripts_updated_at ON scripts(updated_at DESC);
  `);
  migrateLegacyJson();
}

export function listScriptRecords() {
  initDb();
  return querySql<ScriptRow>(`
    SELECT
      id,
      name,
      prompt_title,
      source_prompt,
      code,
      file_path,
      steps_json,
      created_at,
      updated_at
    FROM scripts
    ORDER BY updated_at DESC;
  `).map(rowToRecord);
}

export function getScriptRecord(id: string) {
  initDb();
  const row = querySql<ScriptRow>(`
    SELECT
      id,
      name,
      prompt_title,
      source_prompt,
      code,
      file_path,
      steps_json,
      created_at,
      updated_at
    FROM scripts
    WHERE id = ${sqlString(id)}
    LIMIT 1;
  `)[0];

  return row ? rowToRecord(row) : null;
}

export function upsertScriptRecord(input: {
  name: string;
  promptTitle: string;
  sourcePrompt: string;
  code: string;
  filePath: string;
  steps?: ScriptStepRecord[];
}) {
  initDb();
  const now = new Date().toISOString();
  const id = createId();
  const stepsJson = JSON.stringify(input.steps || []);

  runSql(`
    INSERT INTO scripts (
      id,
      name,
      prompt_title,
      source_prompt,
      code,
      file_path,
      steps_json,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlString(id)},
      ${sqlString(input.name)},
      ${sqlString(input.promptTitle || input.name)},
      ${sqlString(input.sourcePrompt || '')},
      ${sqlString(input.code)},
      ${sqlString(input.filePath)},
      ${sqlString(stepsJson)},
      ${sqlString(now)},
      ${sqlString(now)}
    )
    ON CONFLICT(name) DO UPDATE SET
      prompt_title = excluded.prompt_title,
      source_prompt = excluded.source_prompt,
      code = excluded.code,
      file_path = excluded.file_path,
      steps_json = excluded.steps_json,
      updated_at = excluded.updated_at;
  `);

  const row = querySql<ScriptRow>(`
    SELECT
      id,
      name,
      prompt_title,
      source_prompt,
      code,
      file_path,
      steps_json,
      created_at,
      updated_at
    FROM scripts
    WHERE name = ${sqlString(input.name)}
    LIMIT 1;
  `)[0];

  return rowToRecord(row);
}

export function updateScriptRecordCode(input: { id: string; code: string; filePath?: string }) {
  initDb();
  const now = new Date().toISOString();

  runSql(`
    UPDATE scripts
    SET
      code = ${sqlString(input.code)},
      file_path = COALESCE(${input.filePath ? sqlString(input.filePath) : 'NULL'}, file_path),
      steps_json = '[]',
      updated_at = ${sqlString(now)}
    WHERE id = ${sqlString(input.id)};
  `);

  return getScriptRecord(input.id);
}

export function removeScriptRecord(id: string) {
  initDb();
  const row = querySql<ScriptRow>(`
    SELECT
      id,
      name,
      prompt_title,
      source_prompt,
      code,
      file_path,
      steps_json,
      created_at,
      updated_at
    FROM scripts
    WHERE id = ${sqlString(id)}
    LIMIT 1;
  `)[0];
  runSql(`DELETE FROM scripts WHERE id = ${sqlString(id)};`);
  return row ? rowToRecord(row) : null;
}

export function getScriptDbPath() {
  return dbPath;
}
