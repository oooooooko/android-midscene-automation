import assert from 'node:assert/strict';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('owned device instrumentation is cleaned after success, abort and failed session creation; external servers are untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-cleanup-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, spawn: childProcess.spawn, fetch: globalThis.fetch };
  const calls: string[][] = [];
  let mode = 'success', stopped = false;
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
        return Response.json({ value: { sessionId: 'test-session' } });
      }
      return Response.json({ value: {} });
    };
    const { replayAppiumScript } = await import('./appium-runner');
    const script = {
      id: 'cleanup', name: 'cleanup', deviceId: 'test-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '',
      steps: [{ id: 'log', type: 'log' as const, label: 'log', value: 'ok' }],
    };
    for (mode of ['success', 'abort', 'creation-failure', 'cleanup-failure', 'external']) {
      calls.length = 0;
      controller = new AbortController();
      if (mode === 'external') process.env.APPIUM_SERVER_URL = 'http://external.invalid';
      const result = await replayAppiumScript(script, 'test-device', line => {
        if (mode === 'abort' && line.includes('Appium session 已创建')) controller.abort();
      }, controller.signal);
      assert.equal(calls.length, mode === 'external' ? 0 : 2);
      if (mode !== 'external') {
        assert.deepEqual(calls.map(args => args.slice(0, 5)), Array(2).fill(['-s', 'test-device', 'shell', 'am', 'force-stop']));
        assert.deepEqual(calls.map(args => args.at(-1)).sort(), ['io.appium.uiautomator2.server', 'io.appium.uiautomator2.server.test']);
      }
      if (mode === 'abort') assert.equal(result.stopped, true);
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
