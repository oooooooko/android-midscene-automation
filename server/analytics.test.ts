import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTests, type TestRun } from '../src/analytics/summary';

test('analytics includes unrun and historical scripts and excludes stopped/running from pass rate and average duration', () => {
  const runs: TestRun[] = ['passed', 'failed', 'stopped', 'running'].map((status, i) => ({
    scriptId: 'a', scriptName: 'old name', status: status as TestRun['status'], startedAt: `2026-09-2${i}T00:00:00Z`, durationMs: 1000 * (i + 1),
  }));
  runs.push({ scriptId: 'deleted', scriptName: '历史测试', status: 'passed', startedAt: '2026-09-01T00:00:00Z', durationMs: 10 });
  const result = summarizeTests([{ id: 'a', name: '新名称' }, { id: 'b', name: '未执行' }], runs);
  assert.equal(result.scripts, 2);
  assert.equal(result.runs, 5);
  assert.equal(result.testedScripts, 1);
  assert.equal(result.passRate, 2 / 3);
  const a = result.rows.find(row => row.id === 'a')!;
  assert.equal(a.name, '新名称');
  assert.equal(a.averageDurationMs, 1500);
  assert.equal(a.passRate, 0.5);
  assert.equal(a.lastStatus, 'running');
  assert.equal(result.rows.find(row => row.id === 'b')?.passRate, null);
  assert.equal(result.rows.find(row => row.id === 'deleted')?.archived, true);
  const recent = summarizeTests([{ id: 'b', name: '未执行' }], runs, Date.parse('2026-09-22T00:00:00Z'));
  assert.equal(recent.runs, 2);
  assert.equal(recent.passRate, null);
  assert.equal(recent.rows.find(row => row.id === 'a')?.averageDurationMs, null);
});


test('daily/monthly charts zero-fill calendar buckets and retain older runs in all-time totals', () => {
  const now = new Date(2026, 0, 2, 12).getTime();
  const runs: TestRun[] = [
    { scriptId: 'a', scriptName: 'a', status: 'passed', startedAt: new Date(2026, 0, 2, 8).toISOString(), durationMs: 10 },
    { scriptId: 'a', scriptName: 'a', status: 'failed', startedAt: new Date(2024, 0, 1).toISOString(), durationMs: 10 },
  ];
  const all = summarizeTests([], runs, 0, now);
  assert.equal(all.runs, 2);
  assert.equal(all.daily.length, 30);
  assert.equal(all.monthly.length, 12);
  assert.deepEqual(all.monthly.at(-1), { date: '2026-01', runs: 1 });
  assert.equal(all.daily.reduce((sum, point) => sum + point.runs, 0), 1);
  const recent = summarizeTests([], runs, new Date(2025, 11, 27).getTime(), now);
  assert.equal(recent.daily.length, 7);
  assert.equal(recent.monthly.length, 2);
  assert.equal(recent.runs, 1);
  assert.equal(recent.daily.at(-1)?.date, '2026-01-02');
});
