import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { longPressMode, validateLongPress } from '../src/appium-recorder/long-press';
import { flowStepMeta } from '../src/appium-recorder/flow-labels';
import { normalizeLegacyNestedConditionBranches } from '../src/appium-recorder/flow-normalize';
import type { AppiumRecordedStep } from '../src/appium-recorder/types';

const legacy: AppiumRecordedStep = {
  id: 'legacy', type: 'longPress', label: 'Legacy coordinates',
  fallback: { strategy: 'bounds', centerX: 0, centerY: 150 },
};
const element: AppiumRecordedStep = {
  ...legacy, id: 'element', label: 'Element long press', longPressMode: 'element',
  selector: { strategy: 'id', value: 'example.app:id/target' }, timeoutMs: 1200,
};
assert.equal(longPressMode(legacy), 'coordinates');
assert.equal(longPressMode(element), 'element');
assert.equal(validateLongPress(element), '');
assert.equal(validateLongPress({ ...element, fallback: undefined }), '');
assert.match(validateLongPress({ ...element, selector: undefined }), /定位器/);
assert.match(validateLongPress({ ...element, selector: { strategy: 'bounds' } }), /定位器/);
assert.match(validateLongPress({ ...legacy, fallback: undefined }), /坐标/);
assert.match(validateLongPress({ ...element, timeoutMs: -1 }), /长按时间/);
assert.match(flowStepMeta(legacy), /坐标 0,150 · 800ms/);
assert.match(flowStepMeta(element), /元素 id example.app:id\/target · 1200ms/);

// Replace external transports only; exercise the real replay runner and report generation.
const root = await mkdtemp(join(tmpdir(), 'appium-long-press-check-'));
const savedEnv = { ...process.env };
const originalExecFile = childProcess.execFile;
const originalFetch = globalThis.fetch;
const adbCalls: string[][] = [];
const requests: Array<{ path: string; body: any }> = [];
let elementFound = true;
let currentElementId = 'live-element-1';
try {
  const sdk = join(root, 'sdk');
  const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  await mkdir(join(sdk, 'platform-tools'), { recursive: true });
  await writeFile(adb, '');
  process.env.ANDROID_MIDSCENE_DATA_ROOT = root;
  process.env.ANDROID_SDK_ROOT = sdk;
  process.env.ANDROID_HOME = sdk;
  process.env.APPIUM_SERVER_URL = 'http://appium-test.invalid';
  const screenshot = PNG.sync.write(new PNG({ width: 2, height: 2 }));
  childProcess.execFile = ((command, args, optionsOrCallback, callback) => {
    assert.equal(command, adb, 'No external command may reach a real device');
    adbCalls.push(args);
    const done = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    queueMicrotask(() => done(null, args.includes('screencap') ? screenshot : '', ''));
    return {};
  }) as typeof childProcess.execFile;
  syncBuiltinESMExports();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.host, 'appium-test.invalid');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: url.pathname, body });
    if (url.pathname === '/session') return Response.json({ value: { sessionId: 'test-session' } });
    if (url.pathname.endsWith('/element')) {
      return elementFound
        ? Response.json({ value: { 'element-6066-11e4-a52e-4f735466cecf': currentElementId } })
        : Response.json({ value: { error: 'no such element', message: 'Not found' } }, { status: 404 });
    }
    return Response.json({ value: null });
  };
  const { replayAppiumScript } = await import('../server/appium-recorder/appium-runner');
  async function replay(step: AppiumRecordedStep) {
    requests.length = 0;
    adbCalls.length = 0;
    return replayAppiumScript({
      id: 'test-script', name: 'Long press check', appPackage: 'example.app', appActivity: '',
      deviceId: 'test-device', createdAt: '', updatedAt: '', steps: [step],
    }, 'test-device');
  }

  assert.equal((await replay(element)).success, true);
  assert.deepEqual(requests.find((request) => request.path.endsWith('/element'))?.body,
    { using: 'id', value: 'example.app:id/target' });
  assert.deepEqual(requests.find((request) => request.path.endsWith('/execute/sync'))?.body,
    { script: 'mobile: longClickGesture', args: [{ elementId: currentElementId, duration: 1200 }] });
  assert.equal(adbCalls.some((args) => args.includes('swipe')), false);

  currentElementId = 'live-element-2';
  assert.equal((await replay({ ...element, contextSelector: { strategy: 'id', value: 'parent' } })).success, true);
  assert.ok(requests.some((request) => request.path === '/session/test-session/element/live-element-2/element'));
  assert.equal(requests.find((request) => request.path.endsWith('/execute/sync'))?.body.args[0].elementId, currentElementId);

  elementFound = false;
  assert.equal((await replay(element)).success, false);
  assert.equal(requests.some((request) => request.path.endsWith('/execute/sync')), false);
  assert.equal(adbCalls.some((args) => args.includes('swipe')), false, 'Element mode must not fall back to old coordinates');
  const legacyOptional = { ...element, optional: true };
  assert.equal((await replay(legacyOptional)).success, false, 'Removed optional flag must not skip failures');
  assert.equal((await replay({ ...legacyOptional, flow: { successTargetId: 'missing' } })).success, false, 'Flow replay must not skip failures either');
  const cleaned = normalizeLegacyNestedConditionBranches([legacyOptional]);
  assert.ok(!('optional' in cleaned[0]!));
  assert.equal(legacyOptional.optional, true, 'Migration must not mutate the source');

  assert.equal((await replay(legacy)).success, true);
  assert.deepEqual(adbCalls.find((args) => args.includes('swipe')),
    ['-s', 'test-device', 'shell', 'input', 'swipe', '0', '150', '0', '150', '800']);
  assert.equal(requests.some((request) => request.path.endsWith('/element')), false);
  assert.equal((await replay({ ...element, longPressMode: 'coordinates' })).success, true);
  assert.equal(adbCalls.find((args) => args.includes('swipe'))?.at(-1), '1200');
  console.log('Appium long press checks passed (element commands, live lookup, missing elements, legacy coordinates, reports)');
} finally {
  childProcess.execFile = originalExecFile;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  for (const key of ['ANDROID_MIDSCENE_DATA_ROOT', 'ANDROID_SDK_ROOT', 'ANDROID_HOME', 'APPIUM_SERVER_URL', 'PATH']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(root, { recursive: true, force: true });
}
