export type TestStatus = 'passed' | 'failed' | 'stopped' | 'running';
export type TestRun = { scriptId: string; scriptName: string; startedAt: string; durationMs: number | null; status: TestStatus };
export type ScriptInfo = { id: string; name: string };
export type AnalysisRow = {
  id: string; name: string; archived: boolean;
  runs: number; passed: number; failed: number; stopped: number; running: number;
  passRate: number | null; averageDurationMs: number | null;
  lastRunAt: string; lastStatus: TestStatus | null;
};
export type TrendPoint = { date: string; runs: number };
export type AnalysisSummary = {
  scripts: number; testedScripts: number; runs: number; passed: number; failed: number; stopped: number; running: number;
  passRate: number | null; rows: AnalysisRow[]; daily: TrendPoint[]; monthly: TrendPoint[];
};
export type AnalysisResponse = { generatedAt: string; days: number; midscene: AnalysisSummary; appium: AnalysisSummary };

// Stopped/running executions do not count as completed tests. Missing history is never a pass.
export function summarizeTests(scripts: ScriptInfo[], runs: TestRun[], since = 0, now = Date.now()): AnalysisSummary {
  const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const daily = new Map<string, number>();
  const monthly = new Map<string, number>();
  // Bound the all-time chart while retaining all historical records in the totals/tables.
  const firstDay = since ? new Date(since) : new Date(now);
  if (!since) firstDay.setDate(firstDay.getDate() - 29);
  firstDay.setHours(0, 0, 0, 0);
  for (const cursor = new Date(firstDay); cursor.getTime() <= now; cursor.setDate(cursor.getDate() + 1)) daily.set(dateKey(cursor), 0);
  const firstMonth = since ? new Date(since) : new Date(now);
  firstMonth.setDate(1);
  firstMonth.setHours(0, 0, 0, 0);
  if (!since) firstMonth.setMonth(firstMonth.getMonth() - 11);
  for (const cursor = new Date(firstMonth); cursor.getTime() <= now; cursor.setMonth(cursor.getMonth() + 1)) monthly.set(dateKey(cursor).slice(0, 7), 0);
  const rows = new Map<string, AnalysisRow>();
  const durations = new Map<string, { total: number; count: number }>();
  const makeRow = (id: string, name: string, archived = false): AnalysisRow => ({
    id, name, archived, runs: 0, passed: 0, failed: 0, stopped: 0, running: 0,
    passRate: null, averageDurationMs: null, lastRunAt: '', lastStatus: null,
  });
  for (const script of scripts) rows.set(script.id, makeRow(script.id, script.name));
  for (const run of runs) {
    const time = Date.parse(run.startedAt);
    if (since && (!Number.isFinite(time) || time < since)) continue;
    if (Number.isFinite(time)) {
      const day = dateKey(new Date(time));
      const month = day.slice(0, 7);
      if (daily.has(day)) daily.set(day, daily.get(day)! + 1);
      if (monthly.has(month)) monthly.set(month, monthly.get(month)! + 1);
    }
    const row = rows.get(run.scriptId) ?? makeRow(run.scriptId, run.scriptName || '未命名脚本', true);
    row.runs++;
    row[run.status]++;
    if (!row.lastRunAt || time >= Date.parse(row.lastRunAt)) {
      row.lastRunAt = run.startedAt;
      row.lastStatus = run.status;
    }
    if ((run.status === 'passed' || run.status === 'failed') && run.durationMs !== null && Number.isFinite(run.durationMs) && run.durationMs >= 0) {
      const duration = durations.get(row.id) ?? { total: 0, count: 0 };
      duration.total += run.durationMs;
      duration.count++;
      durations.set(row.id, duration);
    }
    rows.set(row.id, row);
  }
  const result: AnalysisSummary = { scripts: scripts.length, testedScripts: 0, runs: 0, passed: 0, failed: 0, stopped: 0, running: 0, passRate: null, rows: [], daily: [...daily].map(([date, runs]) => ({ date, runs })), monthly: [...monthly].map(([date, runs]) => ({ date, runs })) };
  for (const row of rows.values()) {
    row.passRate = row.passed + row.failed ? row.passed / (row.passed + row.failed) : null;
    const duration = durations.get(row.id);
    row.averageDurationMs = duration ? duration.total / duration.count : null;
    if (!row.archived && row.runs) result.testedScripts++;
    for (const key of ['runs', 'passed', 'failed', 'stopped', 'running'] as const) result[key] += row[key];
    result.rows.push(row);
  }
  result.passRate = result.passed + result.failed ? result.passed / (result.passed + result.failed) : null;
  result.rows.sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt) || a.name.localeCompare(b.name));
  return result;
}
