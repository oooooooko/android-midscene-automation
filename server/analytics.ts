import { summarizeTests, type AnalysisResponse, type TestStatus } from '../src/analytics/summary';
import { listScriptRecords } from './script-db';
import { listAppiumRecordedScripts } from './appium-recorder/repository';
import { listOperationAnalytics } from './operations/repository';
import { listRunAnalytics } from './appium-recorder/run-history';

export function getTestAnalytics(days = 0): AnalysisResponse {
  const generatedAt = new Date().toISOString();
  const start = new Date(generatedAt);
  start.setDate(start.getDate() - Math.max(0, days - 1));
  start.setHours(0, 0, 0, 0);
  const since = days ? start.getTime() : 0;
  const status: Record<string, TestStatus> = { succeeded: 'passed', failed: 'failed', cancelled: 'stopped', running: 'running' };
  return {
    generatedAt, days,
    // Midscene's historical records identify scripts by name, not database ID.
    midscene: summarizeTests(listScriptRecords().map(script => ({ id: script.name, name: script.name })), listOperationAnalytics().map(run => ({
      scriptId: run.script_name, scriptName: run.script_name, startedAt: run.started_at,
      durationMs: run.finished_at ? Date.parse(run.finished_at) - Date.parse(run.started_at) : null,
      status: status[run.status],
    })), since, Date.parse(generatedAt)),
    appium: summarizeTests(listAppiumRecordedScripts().map(script => ({ id: script.id, name: script.name })), listRunAnalytics(), since, Date.parse(generatedAt)),
  };
}
