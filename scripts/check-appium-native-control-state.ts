import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { nativeControlType, parseNativeBoolean, type NativeStateType } from '../src/appium-recorder/native-control-state';
import { defaultFlowKind, flowBranchLabel, labelFlowStep } from '../src/appium-recorder/flow-labels';
import { buildFlowGraph } from '../src/appium-recorder/flow-graph';
import { createFlowClipboard, pasteFlowClipboard } from '../src/appium-recorder/flow-copy';
import { removeFlowStep } from '../src/appium-recorder/flow-remove';
import { mergeBranches } from '../src/appium-recorder/flow-merge';
import { normalizeLegacyNestedConditionBranches } from '../src/appium-recorder/flow-normalize';
import type { AppiumRecordedStep } from '../src/appium-recorder/types';

for (const value of [true, 'true']) assert.equal(parseNativeBoolean(value), true);
for (const value of [false, 'false']) assert.equal(parseNativeBoolean(value), false);
for (const value of [null, undefined, '', 'unknown', 0, 1]) assert.equal(parseNativeBoolean(value), undefined);
assert.equal(nativeControlType('android.widget.CheckBox'), 'checkboxState');
assert.equal(nativeControlType('androidx.appcompat.widget.AppCompatCheckBox'), 'checkboxState');
assert.equal(nativeControlType('com.google.android.material.radiobutton.MaterialRadioButton'), 'radioButtonState');
assert.equal(nativeControlType('android.widget.RadioButton'), 'radioButtonState');
assert.equal(nativeControlType('android.view.View'), undefined);
assert.equal(nativeControlType('android.widget.RadioGroup'), undefined);
for (const name of ['android.widget.Switch', 'androidx.appcompat.widget.SwitchCompat', 'com.google.android.material.switchmaterial.SwitchMaterial', 'com.google.android.material.materialswitch.MaterialSwitch']) {
  assert.equal(nativeControlType(name), 'checkedState');
}

function branchSteps(type: NativeStateType): AppiumRecordedStep[] {
  return [
    { id: 'condition', type, label: type, selector: { strategy: 'id', value: 'example.app:id/control' }, timeoutMs: 1,
      flow: { nodeKind: 'condition', yesTargetId: 'true-child', noTargetId: 'false-child' } },
    { id: 'true-child', type: 'noop', label: 'True action', flow: { parentConditionId: 'condition', parentBranch: 'yes' } },
    { id: 'false-child', type: 'noop', label: 'False action', flow: { parentConditionId: 'condition', parentBranch: 'no' } },
  ];
}

for (const type of ['checkboxState', 'radioButtonState', 'checkedState'] as const) {
  const steps = branchSteps(type);
  assert.equal(defaultFlowKind({ ...steps[0], flow: { nodeKind: 'action' } }), 'condition');
  assert.equal(flowBranchLabel(steps[0], 'yes'), 'true');
  assert.equal(flowBranchLabel(steps[0], 'no'), 'false');
  const graph = buildFlowGraph(steps, {
    expandedStepIndex: null, selectedCopyIndexes: [], copyMode: false, canOpenInsertMenu: true,
    isStartActionDisabled: () => false, isInsertActionDisabled: () => false, isAppExecutionDisabled: () => false,
    startActionGroups: [], mainActionGroups: [], labelStep: labelFlowStep, isCopySelected: () => false,
  });
  assert.deepEqual(graph.nodes.flatMap((node) => node.data.kind === 'branch' ? [node.data.label] : []), ['true', 'false']);
  assert.ok(graph.nodes.filter((node) => node.data.kind === 'branch').every((node) => node.width === 56));
  let nextId = 0;
  const copies = pasteFlowClipboard([], createFlowClipboard(steps, [0]), { afterIndex: -1 }, () => `copy-${++nextId}`);
  assert.equal(copies[0].type, type);
  assert.equal(copies[0].flow?.yesTargetId, copies[1].id);
  assert.equal(copies[0].flow?.noTargetId, copies[2].id);
  const afterRemove = removeFlowStep(steps, 1);
  assert.equal(afterRemove.find((step) => step.id === 'condition')?.flow?.noTargetId, 'false-child');
  assert.equal(afterRemove.find((step) => step.id === 'false-child')?.flow?.parentBranch, 'no');
  const emptyNested = [
    { ...steps[0], flow: { nodeKind: 'condition' as const, parentConditionId: 'outer', parentBranch: 'yes' as const } },
    { ...steps[1], flow: { parentConditionId: 'outer', parentBranch: 'yes' as const } },
  ];
  assert.deepEqual(normalizeLegacyNestedConditionBranches(emptyNested), emptyNested);
}
assert.equal(flowBranchLabel({ type: 'assertExists' }, 'yes'), '是');
assert.equal(flowBranchLabel({ type: 'assertExists' }, 'no'), '否');

// Exercise the real runner and report generation without sending any command to a device.
const root = await mkdtemp(join(tmpdir(), 'native-control-check-'));
const savedEnv = { ...process.env };
const originalExecFile = childProcess.execFile;
const originalFetch = globalThis.fetch;
const requests: string[] = [];
let attributes: Record<string, unknown> = {};
let elementFound = true;
let failAttribute = false;
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
    assert.equal(command, adb);
    assert.equal(args.includes('input'), false, 'State checks must never tap or change the control');
    const done = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    queueMicrotask(() => done(null, args.includes('screencap') ? screenshot : '', ''));
    return {};
  }) as typeof childProcess.execFile;
  syncBuiltinESMExports();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.host, 'appium-test.invalid');
    requests.push(url.pathname);
    if (url.pathname === '/session') return Response.json({ value: { sessionId: 'test-session' } });
    if (url.pathname.endsWith('/element')) return elementFound
      ? Response.json({ value: { 'element-6066-11e4-a52e-4f735466cecf': 'live-control' } })
      : Response.json({ value: { error: 'no such element', message: 'Missing control' } }, { status: 404 });
    if (url.pathname.includes('/attribute/')) return failAttribute
      ? Response.json({ value: { error: 'unknown error', message: 'Attribute unavailable' } }, { status: 500 })
      : Response.json({ value: attributes[url.pathname.split('/').at(-1)!] ?? null });
    assert.equal(/\/(click|value|selected|execute\/sync)$/.test(url.pathname), false);
    return Response.json({ value: null });
  };
  const { replayAppiumScript } = await import('../server/appium-recorder/appium-runner');
  async function replay(type: NativeStateType) {
    requests.length = 0;
    return replayAppiumScript({
      id: 'test-script', name: 'Native control check', appPackage: 'example.app', appActivity: '',
      deviceId: 'test-device', createdAt: '', updatedAt: '', steps: branchSteps(type),
    }, 'test-device');
  }
  for (const [type, className] of [
    ['checkboxState', 'android.widget.CheckBox'],
    ['radioButtonState', 'android.widget.RadioButton'],
    ['checkedState', 'android.widget.CheckBox'],
    ['checkedState', 'android.widget.RadioButton'],
    ['checkedState', 'android.widget.Switch'],
    ['checkedState', 'androidx.appcompat.widget.SwitchCompat'],
    ['checkedState', 'com.google.android.material.switchmaterial.SwitchMaterial'],
    ['checkedState', 'com.google.android.material.materialswitch.MaterialSwitch'],
  ] as const) {
    for (const checked of [true, false, 'true', 'false']) {
      attributes = { className, checkable: 'true', checked };
      const result = await replay(type);
      const matched = parseNativeBoolean(checked);
      assert.equal(result.success, true);
      assert.match(result.output, new RegExp(`判断：${matched}（checked=${matched}）`));
      assert.ok(result.output.includes(`开始：${matched ? 'True' : 'False'} action`));
      assert.ok(!result.output.includes(`开始：${matched ? 'False' : 'True'} action`));
      assert.ok(requests.some((path) => path.endsWith('/attribute/checked')));
      const html = await readFile(result.htmlReportPath!, 'utf8');
      assert.ok(html.includes(`判断：${matched}`), 'HTML timeline includes the observed state');
      const markdown = await readFile(result.reportPath!, 'utf8');
      assert.ok(markdown.includes(`checked=${matched}`));
      assert.ok(markdown.includes('| true 分支 |') && markdown.includes('| false 分支 |'));
    }
  }
  for (const [type, invalidAttributes, message] of [
    ['checkedState', { className: 'android.widget.Button', checkable: true, checked: false }, /不是原生/],
    ['checkedState', { className: 'android.widget.Switch', checkable: false, checked: false }, /checkable/],
    ['checkedState', { className: 'android.widget.Switch', checkable: true, checked: null }, /checked 属性/],
    ['checkboxState', { className: 'android.widget.RadioButton', checkable: true, checked: false }, /不是原生 Checkbox/],
    ['radioButtonState', { className: 'android.widget.CheckBox', checkable: true, checked: false }, /不是原生 RadioButton/],
    ['checkboxState', { className: 'android.view.View', checkable: true, checked: false }, /不是原生/],
    ['checkboxState', { className: 'android.widget.CheckBox', checkable: false, checked: false }, /checkable/],
    ['radioButtonState', { className: 'android.widget.RadioButton', checkable: true, checked: null }, /checked 属性/],
  ] as const) {
    attributes = invalidAttributes;
    const result = await replay(type);
    assert.equal(result.success, false);
    assert.match(result.output, message);
    assert.ok(!result.output.includes('开始：False action'));
    assert.ok((await readFile(result.htmlReportPath!, 'utf8')).includes('失败'));
  }
  for (const checked of [true, false]) {
    attributes = { className: 'android.widget.Switch', checkable: true, checked };
    const source = branchSteps('checkedState');
    source[1] = { ...source[1], type: 'log', value: 'LEFT_ONLY' };
    source.splice(2, 0, { id: 'common', type: 'log', label: '公共流程', value: 'SHARED_ONCE', flow: { parentConditionId: 'condition', parentBranch: 'yes' } });
    const merged = mergeBranches(source, 'condition', 'common', 'false-child').steps;
    const result = await replayAppiumScript({ id: 'merged', name: '合流回放', appPackage: 'example.app', appActivity: '', deviceId: 'test-device', createdAt: '', updatedAt: '', steps: merged }, 'test-device');
    assert.equal(result.success, true, result.output);
    assert.equal((result.output.match(/stageLog:SHARED_ONCE/g) || []).length, 1);
    assert.equal(result.output.includes('stageLog:LEFT_ONLY'), checked);
  }
  failAttribute = true;
  assert.equal((await replay('checkboxState')).success, false);
  failAttribute = false;
  elementFound = false;
  const missing = await replay('radioButtonState');
  assert.equal(missing.success, false);
  assert.ok(!missing.output.includes('判断：false'));
  console.log('Native control checks passed: types, booleans, true/false routing, errors, reports, copy/delete/layout');
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
