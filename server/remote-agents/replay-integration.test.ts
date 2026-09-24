import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('real agent receives stop during replay and retries result delivery without replaying', { skip: process.platform === 'win32', timeout: 25000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'remote-replay-'));
  const env = { ...process.env };
  process.env.ANDROID_MIDSCENE_DATA_ROOT = join(root, 'central');
  process.env.REMOTE_AGENT_TOKEN = 'test-only-token';
  const { handleRemoteAgentRequest } = await import('./routes');
  const { handleAppiumRecorderRequest } = await import('../appium-recorder/routes');
  const { listRemoteAndroidDevices } = await import('./registry');
  const { saveAppiumRecordedScript } = await import('../appium-recorder/repository');
  const { listRunHistory } = await import('../appium-recorder/run-history');
  let sessions = 0, deletes = 0, keys = 0, resultAttempts = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/session') {
      sessions++; res.setHeader('Content-Type', 'application/json'); res.end('{"value":{"sessionId":"test-session"}}'); return;
    }
    if (req.url?.startsWith('/session/')) {
      if (req.method === 'DELETE') deletes++;
      if (req.url.endsWith('/press_keycode')) keys++;
      res.setHeader('Content-Type', 'application/json'); res.end('{"value":{}}'); return;
    }
    if (req.url === '/api/remote-agents/result' && ++resultAttempts === 1) {
      req.resume(); res.statusCode = 503; res.end('{"message":"temporary failure"}'); return;
    }
    if (await handleRemoteAgentRequest(req, res)) return;
    if (await handleAppiumRecorderRequest(req, res, '')) return;
    res.statusCode = 404; res.end();
  });
  let agent: ReturnType<typeof spawn> | undefined;
  const waitFor = async (check: () => boolean) => {
    const until = Date.now() + 12000;
    while (!check()) { assert.ok(Date.now() < until, 'agent action completed within deadline'); await new Promise(resolve => setTimeout(resolve, 25)); }
  };
  try {
    const sdk = join(root, 'sdk'), bin = join(sdk, 'platform-tools');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'adb'), '#!/usr/bin/env node\nif(process.argv.includes("devices")) console.log("List of devices attached\\nfake-device device model:Test");\n', { mode: 0o755 });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const script = saveAppiumRecordedScript({ name: 'remote-test', appPackage: 'example.test', steps: [
      { id: 'wait', type: 'delay', label: 'wait', timeoutMs: 60000 },
      { id: 'home', type: 'key', label: 'Home', keyCode: 3 },
    ] });
    agent = spawn(process.execPath, ['--import', 'tsx', resolve('remote-agent/index.ts'), '--server', base, '--agent-id', 'integration-agent'], {
      env: { ...process.env, ANDROID_MIDSCENE_DATA_ROOT: join(root, 'agent'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, APPIUM_SERVER_URL: base, PATH: `${bin}:${process.env.PATH}` },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = ''; agent.stderr?.on('data', chunk => { stderr += chunk; });
    await waitFor(() => listRemoteAndroidDevices().length > 0);
    const deviceId = listRemoteAndroidDevices()[0]!.id;
    const post = (path: string, data: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(18000) });
    const running = post(`/api/appium-recorder/scripts/${script.id}/replay`, { deviceId, reportSummaryEnabled: false }).then(response => response.json() as Promise<{ stopped: boolean }>);
    await waitFor(() => sessions === 1);
    const stop = await (await post('/api/appium-recorder/replay/stop', { deviceId })).json() as { stopped: boolean };
    assert.equal(stop.stopped, true);
    const result = await running;
    assert.equal(result.stopped, true, stderr);
    assert.equal(sessions, 1, 'retrying the result never replays device actions');
    assert.equal(deletes, 1); assert.equal(keys, 0, 'Home must not run after cancellation');
    assert.equal(resultAttempts, 2, 'temporary result failure is retried');
    const history = listRunHistory(script.id);
    assert.equal(history.length, 1); assert.equal(history[0]?.status, 'stopped'); assert.equal(history[0]?.deviceId, deviceId);
  } finally {
    if (agent && agent.exitCode === null) {
      const exited = new Promise<void>(resolve => agent!.once('exit', () => resolve()));
      agent.kill('SIGKILL'); await exited;
    }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of ['ANDROID_MIDSCENE_DATA_ROOT', 'REMOTE_AGENT_TOKEN']) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
    await rm(root, { recursive: true, force: true });
  }
});
