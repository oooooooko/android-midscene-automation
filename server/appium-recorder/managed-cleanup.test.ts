import assert from 'node:assert/strict';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('replay survives command idle periods and cleans sessions after success, abort and creation failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-cleanup-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, spawn: childProcess.spawn, fetch: globalThis.fetch };
  const calls: string[][] = [];
  let mode = 'success', stopped = false;
  let elapsedMs = 0, lastCommandMs = 0, commandTimeoutMs = 60_000;
  let keyCommands = 0, deletedSessions = 0;
  let controller = new AbortController();
  try {
    const sdk = join(root, 'sdk');
    await mkdir(join(sdk, 'platform-tools'), { recursive: true });
    await writeFile(join(sdk, 'platform-tools', 'adb'), '');
    Object.assign(process.env, { ANDROID_MIDSCENE_DATA_ROOT: root, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk });
    delete process.env.APPIUM_SERVER_URL;
    childProcess.spawn = (() => {
      stopped = false;
      const child = Object.assign(new EventEmitter(), {
        pid: 12345, exitCode: null as number | null, stdout: new PassThrough(), stderr: new PassThrough(),
        kill: () => { stopped = true; child.exitCode = 0; child.emit('exit', 0); return true; },
      });
      return child;
    }) as unknown as typeof childProcess.spawn;
    childProcess.execFile = ((_command, args, options, callback) => {
      if (args.includes('force-stop')) {
        assert.equal(stopped, true, 'stop owned host server before device cleanup');
        assert.equal(options.signal, undefined, 'cleanup must not inherit an aborted signal');
        assert.equal(options.timeout, 3000);
        calls.push(args);
      }
      queueMicrotask(() => callback(mode === 'cleanup-failure' && args.includes('force-stop') ? new Error('offline') : null, '', ''));
      return {};
    }) as typeof childProcess.execFile;
    syncBuiltinESMExports();
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/session' && init?.method === 'POST') {
        if (mode === 'creation-failure') return Response.json({ value: { error: 'session not created', message: 'creation failed' } }, { status: 500 });
        const capabilities = JSON.parse(String(init.body)).capabilities.alwaysMatch;
        commandTimeoutMs = (capabilities['appium:newCommandTimeout'] ?? 60) * 1000;
        lastCommandMs = elapsedMs;
        return Response.json({ value: { sessionId: 'test-session' } });
      }
      if (path.endsWith('/press_keycode')) {
        keyCommands++;
        // Model Appium's idle expiry without waiting a real minute or touching a device.
        if (commandTimeoutMs && elapsedMs - lastCommandMs > commandTimeoutMs) {
          return Response.json({ value: { error: 'invalid session id', message: 'New Command Timeout expired' } }, { status: 404 });
        }
        lastCommandMs = elapsedMs;
      }
      if (path === '/session/test-session' && init?.method === 'DELETE') deletedSessions++;
      return Response.json({ value: {} });
    };
    const { replayAppiumScript } = await import('./appium-runner');
    const script = {
      id: 'cleanup', name: 'cleanup', deviceId: 'test-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '',
      steps: [{ id: 'log', type: 'log' as const, label: 'log', value: 'ok' }],
    };
    for (mode of ['success', 'long-idle', 'abort', 'creation-failure', 'cleanup-failure', 'external', 'external-abort']) {
      calls.length = 0;
      elapsedMs = lastCommandMs = keyCommands = deletedSessions = 0;
      controller = new AbortController();
      const external = mode.startsWith('external');
      const aborted = mode.endsWith('abort');
      const longIdle = mode.endsWith('long-idle');
      if (external) process.env.APPIUM_SERVER_URL = 'http://external.invalid';
      else delete process.env.APPIUM_SERVER_URL;
      const replayScript = longIdle ? { ...script, steps: [
        ...script.steps,
        { id: 'home', type: 'key' as const, label: 'Home', keyCode: 3 },
      ] } : script;
      const result = await replayAppiumScript(replayScript, 'test-device', line => {
        // ADB operations and model inference do not reset Appium's command timer.
        if (longIdle && line.includes('[节点 1] 完成')) elapsedMs += 120_000;
        if (aborted && line.includes('Appium session 已创建')) controller.abort();
      }, controller.signal);
      assert.equal(calls.length, external ? 0 : 2);
      assert.equal(deletedSessions, mode === 'creation-failure' || (aborted && !external) ? 0 : 1, 'release the replay session even when idle expiry is disabled');
      if (!external) {
        assert.deepEqual(calls.map(args => args.slice(0, 5)), Array(2).fill(['-s', 'test-device', 'shell', 'am', 'force-stop']));
        assert.deepEqual(calls.map(args => args.at(-1)).sort(), ['io.appium.uiautomator2.server', 'io.appium.uiautomator2.server.test']);
      }
      if (longIdle) {
        assert.equal(keyCommands, 1, 'execute Home after the long interval without Appium commands');
        assert.equal(result.success, true, result.output);
      }
      if (aborted) assert.equal(result.stopped, true);
      if (mode === 'creation-failure') assert.equal(result.success, false);
      if (mode === 'cleanup-failure') assert.match(result.output, /UiAutomator2 清理失败/);
    }
  } finally {
    childProcess.execFile = original.execFile;
    childProcess.spawn = original.spawn;
    globalThis.fetch = original.fetch;
    syncBuiltinESMExports();
    for (const key of ['ANDROID_MIDSCENE_DATA_ROOT', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'APPIUM_SERVER_URL']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
