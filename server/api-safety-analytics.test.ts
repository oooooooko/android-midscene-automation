import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisResponse } from '../src/analytics/summary';

test('API rejects malformed requests safely and analytics reads all stored executions without a 100-record cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-api-'));
  const oldRoot = process.env.ANDROID_MIDSCENE_DATA_ROOT;
  process.env.ANDROID_MIDSCENE_DATA_ROOT = root;
  const { createApiMiddleware } = await import('./http-api');
  const handler = createApiMiddleware();
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    for (const path of ['/api/config', '/api/config/appium', '/api/test-model', '/api/appium-recorder/scripts', '/api/generate']) {
      assert.equal((await fetch(base + path, { method: 'POST', body: '{' })).status, 400, path);
    }
    assert.equal((await fetch(base + '/api/config', { headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.equal((await fetch(base + '/api/config')).status, 200);
    const { upsertScriptRecord } = await import('./script-db');
    upsertScriptRecord({ name: 'Midscene 测试', promptTitle: '', sourcePrompt: '', code: 'private-code', filePath: '', steps: [] });
    upsertScriptRecord({ name: '未执行', promptTitle: '', sourcePrompt: '', code: '', filePath: '', steps: [] });
    const { initOperationRepository } = await import('./operations/repository');
    const { runSql, sqlString } = await import('./storage/sqlite');
    initOperationRepository();
    const started = new Date(Date.now() - 10_000).toISOString();
    const finished = new Date().toISOString();
    runSql(Array.from({ length: 105 }, (_, i) => `INSERT INTO operations (id, kind, status, script_name, device_id, session_id, created_at, started_at, finished_at) VALUES ('op-${i}', 'script_run', '${i === 0 ? 'failed' : 'succeeded'}', 'Midscene 测试', '', '', ${sqlString(started)}, ${sqlString(started)}, ${sqlString(finished)});`).join('\n'));
    const { saveAppiumRecordedScript } = await import('./appium-recorder/repository');
    const script = saveAppiumRecordedScript({ name: 'Appium 测试', appPackage: 'example.test', steps: [] });
    const { saveRunHistory } = await import('./appium-recorder/run-history');
    saveRunHistory({ scriptId: script.id, scriptName: script.name, appPackage: 'example.test', appVersion: '1', deviceId: '', startedAt: started, durationMs: 4000, status: 'passed', nodes: [], output: 'private-output', frames: [] });
    const response = await fetch(base + '/api/analytics');
    const body = await response.text();
    const summary = JSON.parse(body) as AnalysisResponse;
    assert.equal(response.status, 200);
    assert.equal(summary.midscene.runs, 105);
    assert.equal(summary.midscene.scripts, 2);
    assert.equal(summary.midscene.failed, 1);
    assert.equal(summary.midscene.rows.find(row => row.name === '未执行')?.runs, 0);
    assert.equal(summary.appium.runs, 1);
    assert.equal(summary.appium.passRate, 1);
    assert.equal(body.includes('private-'), false);
    assert.equal((await fetch(base + '/api/analytics?days=invalid')).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldRoot === undefined) delete process.env.ANDROID_MIDSCENE_DATA_ROOT; else process.env.ANDROID_MIDSCENE_DATA_ROOT = oldRoot;
    await rm(root, { recursive: true, force: true });
  }
});
