import assert from 'node:assert/strict';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppiumRecordedScriptRecord } from './repository';

test('element taps use the live element center through ADB without waiting for Appium click acknowledgement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'element-tap-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, fetch: globalThis.fetch };
  const appiumPaths: string[] = [];
  const adbCalls: string[][] = [];
  let elementRequestCount = 0;
  try {
    const sdk = join(root, 'sdk');
    await mkdir(join(sdk, 'platform-tools'), { recursive: true });
    await writeFile(join(sdk, 'platform-tools', 'adb'), '');
    Object.assign(process.env, {
      ANDROID_MIDSCENE_DATA_ROOT: root,
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      APPIUM_SERVER_URL: 'http://external.invalid',
    });
    childProcess.execFile = ((_command, args: string[], _options, callback) => {
      adbCalls.push(args);
      queueMicrotask(() => callback(null, '', ''));
      return {};
    }) as typeof childProcess.execFile;
    syncBuiltinESMExports();
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      appiumPaths.push(`${init?.method || 'GET'} ${path}`);
      if (path === '/session' && init?.method === 'POST') {
        return Response.json({ value: { sessionId: 'test-session' } });
      }
      if (path === '/session/test-session/element' && init?.method === 'POST') {
        elementRequestCount += 1;
        return Response.json({ value: { 'element-6066-11e4-a52e-4f735466cecf': `button-${elementRequestCount}` } });
      }
      if (path === '/session/test-session/element/button-2/rect') {
        return Response.json({ value: { error: 'stale element reference', message: 'element changed' } }, { status: 404 });
      }
      if (/\/element\/button-[13]\/rect$/.test(path)) {
        return Response.json({ value: { x: 10, y: 20, width: 100, height: 60 } });
      }
      return Response.json({ value: null });
    };
    const { replayAppiumScript } = await import('./appium-runner');
    const script: AppiumRecordedScriptRecord = {
      id: 'tap', name: 'tap', deviceId: 'fake-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '',
      steps: [{
        id: 'login', type: 'tap', label: '点击登录按钮',
        selector: { strategy: 'id', value: 'example:id/login', unique: true },
        fallback: { strategy: 'bounds', centerX: 999, centerY: 999 },
      }, {
        id: 'refreshing', type: 'tap', label: '点击刷新列表中的按钮',
        selector: { strategy: 'id', value: 'example:id/refreshing', unique: true },
        fallback: { strategy: 'bounds', centerX: 999, centerY: 999 },
      }],
    };
    const result = await replayAppiumScript(script, 'fake-device', undefined, undefined, {
      screenshotReport: false,
      reportSummaryEnabled: false,
    });
    assert.equal(result.success, true, result.output);
    assert.ok(appiumPaths.includes('GET /session/test-session/element/button-1/rect'));
    assert.ok(appiumPaths.includes('GET /session/test-session/element/button-3/rect'));
    assert.equal(elementRequestCount, 3, 're-locate once after a stale element rect');
    assert.equal(appiumPaths.some(path => path.endsWith('/click')), false, 'must not call the blocking Appium click endpoint');
    assert.deepEqual(adbCalls.filter(args => args.includes('tap')).map(args => args.slice(-4)), [
      ['input', 'tap', '60', '50'],
      ['input', 'tap', '60', '50'],
    ]);
  } finally {
    childProcess.execFile = original.execFile;
    globalThis.fetch = original.fetch;
    syncBuiltinESMExports();
    for (const key of ['ANDROID_MIDSCENE_DATA_ROOT', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'APPIUM_SERVER_URL']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
