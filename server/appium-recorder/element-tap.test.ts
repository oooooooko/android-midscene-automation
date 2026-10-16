import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppiumRecordedScriptRecord } from './repository';

test('element taps and long presses use the live element center through ADB without waiting for Appium gesture acknowledgement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'element-tap-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, fetch: globalThis.fetch };
  const appiumPaths: string[] = [];
  const adbCalls: string[][] = [];
  let elementRequestCount = 0;
  let absentRequestCount = 0;
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
      const stdout = args.includes('activities')
        ? 'topResumedActivity=ActivityRecord{abc example.test/.Login t1}'
        : '';
      queueMicrotask(() => callback(null, stdout, ''));
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
        const selector = JSON.parse(String(init.body)).value;
        if (selector === 'example:id/absent') {
          absentRequestCount += 1;
          await new Promise(resolve => setTimeout(resolve, 70));
          return Response.json({ value: { error: 'no such element', message: 'not found' } }, { status: 404 });
        }
        elementRequestCount += 1;
        return Response.json({ value: { 'element-6066-11e4-a52e-4f735466cecf': `button-${elementRequestCount}` } });
      }
      if (path === '/session/test-session/element/button-4/rect') {
        return Response.json({ value: { error: 'stale element reference', message: 'element changed' } }, { status: 404 });
      }
      if (/\/element\/button-(?:[1-3]|[5-6])\/rect$/.test(path)) {
        return Response.json({ value: { x: 10, y: 20, width: 100, height: 60 } });
      }
      return Response.json({ value: null });
    };
    const { replayAppiumScript } = await import('./appium-runner');
    const script: AppiumRecordedScriptRecord = {
      id: 'tap', name: 'tap', deviceId: 'fake-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '',
      steps: [{
        id: 'recorded', type: 'tap', label: '点击录制页面按钮',
        selector: { strategy: 'id', value: 'example:id/recorded', unique: true },
        fallback: { strategy: 'bounds', centerX: 90, centerY: 190 },
        pageBefore: { activity: 'example.test/.Login' },
      }, {
        id: 'invalid-recorded-position', type: 'tap', label: '无效录制坐标改用实时组件位置',
        selector: { strategy: 'id', value: 'example:id/live-position', unique: true },
        fallback: { strategy: 'bounds', centerX: 0, centerY: 0 },
        pageBefore: { activity: 'example.test/.Login' },
      }, {
        id: 'login', type: 'tap', label: '点击登录按钮',
        selector: { strategy: 'id', value: 'example:id/login', unique: true },
        fallback: { strategy: 'bounds', centerX: 999, centerY: 999 },
      }, {
        id: 'refreshing', type: 'tap', label: '点击刷新列表中的按钮',
        selector: { strategy: 'id', value: 'example:id/refreshing', unique: true },
        fallback: { strategy: 'bounds', centerX: 999, centerY: 999 },
      }, {
        id: 'long-press', type: 'longPress', label: '长按设备', longPressMode: 'element', timeoutMs: 800,
        selector: { strategy: 'id', value: 'example:id/device', unique: true },
        fallback: { strategy: 'bounds', centerX: 999, centerY: 999 },
      }, {
        id: 'home', type: 'key', label: 'Home', keyCode: 3,
      }, {
        id: 'back-if-exists', type: 'backIfExists', label: '弹窗存在则返回',
        selector: { strategy: 'id', value: 'example:id/dialog', unique: true }, timeoutMs: 100,
      }, {
        id: 'absent', type: 'tapIfExists', label: '不存在则跳过',
        selector: { strategy: 'id', value: 'example:id/absent', unique: true },
        selectorChain: [{ strategy: 'xpath', value: "//*[@resource-id='example:id/absent']", unique: true }], timeoutMs: 100,
      }],
    };
    const result = await replayAppiumScript(script, 'fake-device', undefined, undefined, {
      screenshotReport: false,
      reportSummaryEnabled: false,
    });
    assert.equal(result.success, true, result.output);
    assert.ok(appiumPaths.includes('GET /session/test-session/element/button-1/rect'));
    assert.ok(appiumPaths.includes('GET /session/test-session/element/button-5/rect'));
    assert.equal(elementRequestCount, 7, 'always locate component ids first and re-locate once after a stale rect');
    assert.equal(absentRequestCount, 1, 'do not repeat the primary selector with an unsafe deadline remainder');
    assert.equal(appiumPaths.some(path => path.endsWith('/click')), false, 'must not call the blocking Appium click endpoint');
    assert.equal(appiumPaths.some(path => path.endsWith('/execute/sync')), false, 'must not call the blocking Appium gesture endpoint for long presses');
    assert.equal(appiumPaths.some(path => path.endsWith('/press_keycode')), false, 'must not call the blocking Appium key endpoint');
    assert.deepEqual(adbCalls.filter(args => args.includes('tap')).map(args => args.slice(-4)), [
      ['input', 'tap', '60', '50'],
      ['input', 'tap', '60', '50'],
      ['input', 'tap', '60', '50'],
      ['input', 'tap', '60', '50'],
    ]);
    assert.deepEqual(adbCalls.find(args => args.includes('swipe'))?.slice(-7), ['input', 'swipe', '60', '50', '60', '50', '800']);
    assert.deepEqual(adbCalls.filter(args => args.includes('keyevent')).map(args => args.slice(-3)), [
      ['input', 'keyevent', '3'],
      ['input', 'keyevent', '4'],
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

test('text matching does not start another Appium query at the node deadline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'text-deadline-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, fetch: globalThis.fetch };
  let elementQueries = 0;
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
    childProcess.execFile = ((_command, _args: string[], _options, callback) => {
      queueMicrotask(() => callback(null, '', ''));
      return {};
    }) as typeof childProcess.execFile;
    syncBuiltinESMExports();
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/session' && init?.method === 'POST') {
        return Response.json({ value: { sessionId: 'deadline-session' } });
      }
      if (path === '/session/deadline-session/elements') {
        elementQueries += 1;
        await new Promise(resolve => setTimeout(resolve, 70));
        return Response.json({ value: [] });
      }
      return Response.json({ value: null });
    };
    const { replayAppiumScript } = await import('./appium-runner');
    const script: AppiumRecordedScriptRecord = {
      id: 'deadline', name: 'deadline', deviceId: 'fake-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '',
      steps: [{
        id: 'text', type: 'textClick', label: '短时间查找文字', value: '不存在', timeoutMs: 100,
        timeoutBranch: 'no', flow: { noTargetId: 'done' },
      }, { id: 'done', type: 'noop', label: '继续执行' }],
    };
    const result = await replayAppiumScript(script, 'fake-device', undefined, undefined, {
      screenshotReport: false,
      reportSummaryEnabled: false,
    });
    assert.equal(result.success, true, result.output);
    assert.equal(elementQueries, 1, 'the final 30ms must not start another Appium query');
    assert.match(result.output, /判断超时，按配置进入右侧分支/);
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

test('missing element completes its last query and follows the timeout branch without reporting a service failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'text-deadline-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, fetch: globalThis.fetch };
  let elementQueries = 0;
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
    childProcess.execFile = ((_command, _args: string[], _options, callback) => {
      queueMicrotask(() => callback(null, '', ''));
      return {};
    }) as typeof childProcess.execFile;
    syncBuiltinESMExports();
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/session' && init?.method === 'POST') {
        return Response.json({ value: { sessionId: 'deadline-session' } });
      }
      if (path === '/session/deadline-session/element') {
        elementQueries += 1;
        await delay(150, undefined, { signal: init?.signal ?? undefined });
        return Response.json({ value: { error: 'no such element', message: 'not found' } }, { status: 404 });
      }
      return Response.json({ value: null });
    };
    const { replayAppiumScript } = await import('./appium-runner');
    const script: AppiumRecordedScriptRecord = {
      id: 'deadline', name: 'deadline', deviceId: 'fake-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '',
      steps: [{
        id: 'text', type: 'assertExists', label: '判断低功耗主页', timeoutMs: 100,
        selector: { strategy: 'id', value: 'example:id/batterItem', unique: true },
        timeoutBranch: 'no', flow: { nodeKind: 'condition', noTargetId: 'done' },
      }, { id: 'done', type: 'noop', label: '继续执行' }],
    };
    const result = await replayAppiumScript(script, 'fake-device', undefined, undefined, {
      screenshotReport: false,
      reportSummaryEnabled: false,
    });
    assert.equal(result.success, true, result.output);
    assert.doesNotMatch(result.output, /服务无响应/);
    assert.equal(elementQueries, 1, 'no retry after the node deadline');
    assert.match(result.output, /判断超时，按配置进入右侧分支/);
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

test('optional tap recovers a blocked UiAutomator2 session and uses the ADB hierarchy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'optional-recovery-'));
  const env = { ...process.env };
  const original = { execFile: childProcess.execFile, fetch: globalThis.fetch };
  const adbCalls: string[][] = [];
  let sessions = 0;
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
      const stdout = args.includes('cat')
        ? '<hierarchy><node resource-id="example:id/optional" bounds="[20,40][120,100]" /></hierarchy>'
        : args.includes('dump') ? 'UI hierchary dumped' : '';
      queueMicrotask(() => callback(null, stdout, ''));
      return {};
    }) as typeof childProcess.execFile;
    syncBuiltinESMExports();
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/session' && init?.method === 'POST') {
        sessions += 1;
        return Response.json({ value: { sessionId: sessions === 1 ? 'blocked-session' : 'recovered-session' } });
      }
      if (path === '/session/blocked-session/element') {
        await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      }
      return Response.json({ value: null });
    };
    const { replayAppiumScript } = await import('./appium-runner');
    const script: AppiumRecordedScriptRecord = {
      id: 'recover', name: 'recover', deviceId: 'fake-device', appPackage: '', appActivity: '', createdAt: '', updatedAt: '',
      steps: [{
        id: 'optional', type: 'tapIfExists', label: '存在则点击', timeoutMs: 100,
        selector: { strategy: 'id', value: 'example:id/optional', unique: true },
        fallback: { strategy: 'bounds', centerX: 999, centerY: 999 },
      }],
    };
    const result = await replayAppiumScript(script, 'fake-device', undefined, undefined, {
      screenshotReport: false,
      reportSummaryEnabled: false,
    });
    assert.equal(result.success, true, result.output);
    assert.equal(sessions, 2, 'replace the blocked session before continuing');
    assert.deepEqual(adbCalls.find(args => args.includes('tap'))?.slice(-4), ['input', 'tap', '70', '70']);
    assert.match(result.output, /ADB 组件树发现目标并已点击/);
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
