import assert from 'node:assert/strict';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AppiumRecordedScriptRecord, AppiumRecordedStepRecord } from './repository';

test('ADB cancellation and deadlines cover actions; external sessions survive idle work and expire after creation cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replay-lifecycle-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let controller = new AbortController();
  let mode = '', deletes = 0, launchedAfterAbort = false;
  let requestCount = 0;
  try {
    const sdk = join(root, 'sdk');
    await mkdir(join(sdk, 'platform-tools'), { recursive: true });
    await writeFile(join(sdk, 'platform-tools', 'adb'), '');
    Object.assign(process.env, { ANDROID_MIDSCENE_DATA_ROOT: root, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, APPIUM_SERVER_URL: 'http://external.invalid' });
    childProcess.execFile = ((_cmd, args: string[], options, callback) => {
      requestCount++;
      if (mode === 'foreground-abort' && args.includes('activities')) {
        queueMicrotask(() => { controller.abort(); callback(new Error('aborted'), '', ''); });
      } else if (args.includes('monkey') || args.includes('clear') || args.includes('input')) {
        launchedAfterAbort ||= controller.signal.aborted;
        assert.ok(options.timeout > 0, 'every device action has a deadline');
        assert.equal(options.signal, controller.signal);
        if (mode === 'timeout') {
          queueMicrotask(() => callback(new Error('ADB command timed out'), '', ''));
        } else {
          options.signal.addEventListener('abort', () => callback(new Error('aborted'), '', ''), { once: true });
          queueMicrotask(() => controller.abort());
        }
      } else queueMicrotask(() => callback(null, '', ''));
      return {};
    }) as typeof childProcess.execFile;
    syncBuiltinESMExports();
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'DELETE') deletes++;
      return Response.json({ value: new URL(String(input)).pathname === '/session' ? { sessionId: 'test-session' } : {} });
    };
    const { replayAppiumScript, launchAppOnDevice, clearAppDataOnDevice } = await import('./appium-runner');
    const script: AppiumRecordedScriptRecord = { id: 'audit', name: 'audit', deviceId: 'fake-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '', steps: [] };
    const run = (steps: AppiumRecordedStepRecord[]) => replayAppiumScript({ ...script, steps }, 'fake-device', undefined, controller.signal, { screenshotReport: false, reportSummaryEnabled: false });
    const actions: AppiumRecordedStepRecord[] = [
      { id: 'launch', type: 'launchApp', label: 'launch', value: 'example.test' },
      { id: 'clear', type: 'clearAppData', label: 'clear', value: 'example.test' },
      { id: 'tap', type: 'coordinateTap', label: 'tap', fallback: { strategy: 'bounds', centerX: 10, centerY: 10 } },
      { id: 'swipe', type: 'swipe', label: 'swipe', swipe: { startX: 10, startY: 10, endX: 50, endY: 50, duration: 100 } },
    ];
    for (const action of actions) {
      mode = 'abort'; controller = new AbortController(); deletes = 0;
      assert.equal((await run([action])).stopped, true, action.type);
      assert.equal(deletes, 1, 'abort releases the known external session');
    }
    mode = 'foreground-abort'; controller = new AbortController(); launchedAfterAbort = false;
    assert.equal((await run([actions[0]!])).stopped, true);
    assert.equal(launchedAfterAbort, false, 'foreground cancellation must not launch monkey');
    const count = requestCount;
    assert.throws(() => launchAppOnDevice('fake', 'example.test', controller.signal));
    assert.throws(() => clearAppDataOnDevice('fake', 'example.test', controller.signal));
    assert.equal(requestCount, count, 'already-cancelled actions never spawn');
    mode = 'timeout'; controller = new AbortController(); deletes = 0;
    const failed = await run([actions[0]!]);
    assert.equal(failed.success, false); assert.match(failed.output, /timed out/); assert.equal(deletes, 1);

    // A local HTTP server models the idle lease at accelerated time, without a real device.
    globalThis.fetch = original.fetch;
    globalThis.setInterval = ((fn, ms, ...args) => original.setInterval(fn, ms === 15000 ? 15 : ms, ...args)) as typeof setInterval;
    let active = false, timeoutSeconds = 0, heartbeats = 0, homeKeys = 0, deleted = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let createdResolve: () => void = () => {};
    const renew = () => { clearTimeout(expiry); expiry = setTimeout(() => { active = false; }, timeoutSeconds * 3); };
    const server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        timeoutSeconds = JSON.parse(body).capabilities.alwaysMatch['appium:newCommandTimeout'];
        if (mode === 'creation-abort') { controller.abort(); await new Promise(resolve => setTimeout(resolve, 20)); }
        active = true; renew(); createdResolve();
        res.end(JSON.stringify({ value: { sessionId: 'delayed-session' } }));
      } else if (req.method === 'DELETE') {
        deleted++; active = false; clearTimeout(expiry); res.end('{"value":null}');
      } else if (!active) {
        res.statusCode = 404; res.end('{"value":{"error":"invalid session id"}}');
      } else {
        renew();
        if (req.url?.endsWith('/timeouts')) heartbeats++;
        if (req.url?.endsWith('/press_keycode')) homeKeys++;
        res.end('{"value":{}}');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.APPIUM_SERVER_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      mode = 'long-idle'; controller = new AbortController();
      const result = await run([{ id: 'wait', type: 'delay', label: 'idle', timeoutMs: 450 }, { id: 'home', type: 'key', label: 'Home', keyCode: 3 }]);
      assert.equal(result.success, true, result.output);
      assert.equal(timeoutSeconds, 60); assert.ok(heartbeats > 3); assert.equal(homeKeys, 1); assert.equal(deleted, 1);
      const heartbeatCount = heartbeats;
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(heartbeats, heartbeatCount, 'heartbeat stops after cleanup');
      mode = 'creation-abort'; controller = new AbortController();
      const created = new Promise<void>(resolve => { createdResolve = resolve; });
      assert.equal((await run([actions[0]!])).stopped, true);
      await created;
      assert.equal(active, true, 'server can create a session after the client cancelled');
      await new Promise(resolve => setTimeout(resolve, 220));
      assert.equal(active, false, 'unclaimed external session has a finite idle lease');
    } finally {
      clearTimeout(expiry); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally {
    childProcess.execFile = original.execFile; globalThis.fetch = original.fetch; globalThis.setInterval = original.setInterval; syncBuiltinESMExports();
    for (const key of ['ANDROID_MIDSCENE_DATA_ROOT', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'APPIUM_SERVER_URL']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
