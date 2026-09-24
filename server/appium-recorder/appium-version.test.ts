import assert from 'node:assert/strict';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { getAppiumVersion } from './managed-appium';

test('Appium version uses the configured runtime and reports unavailable versions without a guessed fallback', async () => {
  const original = { execFile: childProcess.execFile, fetch: globalThis.fetch };
  const env = { executable: process.env.APPIUM_EXECUTABLE, url: process.env.APPIUM_SERVER_URL };
  let output = '3.5.0-beta.1\n';
  let commandError: Error | null = null;
  let executions = 0;
  try {
    delete process.env.APPIUM_SERVER_URL;
    process.env.APPIUM_EXECUTABLE = '/custom/appium';
    childProcess.execFile = ((command, args, options, callback) => {
      executions++;
      assert.equal(command, '/custom/appium');
      assert.deepEqual(args, ['--version']);
      assert.equal(options.timeout, 5000);
      queueMicrotask(() => callback(commandError, output, ''));
      return {};
    }) as typeof childProcess.execFile;
    syncBuiltinESMExports();
    assert.equal((await getAppiumVersion()).version, '3.5.0-beta.1');
    output = 'Warning: Node 24.19.0 is unsupported';
    assert.equal((await getAppiumVersion()).version, null, 'do not mistake diagnostic output for the Appium version');
    commandError = Object.assign(new Error('missing'), { code: 'ENOENT' });
    assert.match((await getAppiumVersion()).message, /未检测到/);
    commandError = new Error('timeout');
    assert.match((await getAppiumVersion()).message, /读取.*失败/);

    process.env.APPIUM_SERVER_URL = 'http://appium.example/wd/hub/';
    const localExecutions = executions;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://appium.example/wd/hub/status');
      assert.ok(options?.signal);
      return Response.json({ value: { ready: true, build: { version: '2.19.0' } } });
    };
    assert.deepEqual(await getAppiumVersion(), { version: '2.19.0', source: 'server', message: '当前配置的 Appium 服务' });
    globalThis.fetch = async () => Response.json({ value: {} });
    assert.equal((await getAppiumVersion()).version, null);
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    assert.match((await getAppiumVersion()).message, /无法连接/);
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal((await getAppiumVersion()).version, null);
    assert.equal(executions, localExecutions, 'external service failures must not show an unrelated local version');
  } finally {
    childProcess.execFile = original.execFile;
    globalThis.fetch = original.fetch;
    syncBuiltinESMExports();
    if (env.executable === undefined) delete process.env.APPIUM_EXECUTABLE; else process.env.APPIUM_EXECUTABLE = env.executable;
    if (env.url === undefined) delete process.env.APPIUM_SERVER_URL; else process.env.APPIUM_SERVER_URL = env.url;
  }
});
