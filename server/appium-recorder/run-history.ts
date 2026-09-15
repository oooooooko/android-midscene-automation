import { createId, querySql, runSql, sqlJson, sqlString } from '../storage/sqlite';
import type { RunDetail, RunSummary } from '../../src/appium-recorder/run-history';

function ensureTable() {
  runSql(`CREATE TABLE IF NOT EXISTS appium_run_history (
    id TEXT PRIMARY KEY, script_id TEXT NOT NULL, started_at TEXT NOT NULL,
    summary TEXT NOT NULL, detail TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS appium_run_history_script ON appium_run_history(script_id, started_at);`);
}

export function saveRunHistory(input: Omit<RunDetail, 'id'>) {
  ensureTable();
  const record = { ...input, id: createId('run') };
  const { frames, output, ...summary } = record;
  runSql(`INSERT INTO appium_run_history VALUES (${sqlString(record.id)}, ${sqlString(record.scriptId)}, ${sqlString(record.startedAt)}, ${sqlJson(summary)}, ${sqlJson({ frames, output })});`);
  return record.id;
}

export function listRunHistory(scriptId: string): RunSummary[] {
  ensureTable();
  return (querySql<{ summary: string }>(`SELECT summary FROM appium_run_history WHERE script_id=${sqlString(scriptId)} ORDER BY started_at DESC;`) || []).map(row => JSON.parse(row.summary));
}

export function getRunHistory(scriptId: string, id: string): RunDetail | null {
  ensureTable();
  const row = querySql<{ summary: string; detail: string }>(`SELECT summary, detail FROM appium_run_history WHERE script_id=${sqlString(scriptId)} AND id=${sqlString(id)};`)?.[0];
  return row ? { ...JSON.parse(row.summary), ...JSON.parse(row.detail) } : null;
}

export function deleteRunHistory(scriptId: string, id: string) {
  ensureTable();
  // 不接受文件路径，也不删除原始报告；只删除这条历史的自包含快照。
  runSql(`PRAGMA secure_delete=ON; DELETE FROM appium_run_history WHERE script_id=${sqlString(scriptId)} AND id=${sqlString(id)};`);
}
