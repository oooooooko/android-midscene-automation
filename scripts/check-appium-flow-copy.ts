import assert from 'node:assert/strict';
import { createFlowClipboard, pasteFlowClipboard } from '../src/appium-recorder/flow-copy';
import { buildConditionLayouts, placeConditionLayout } from '../src/appium-recorder/flow-layout';
import type { AppiumRecordedStep } from '../src/appium-recorder/types';

const steps: AppiumRecordedStep[] = [
  {
    id: 'condition',
    type: 'assertExists',
    label: '判断存在',
    flow: {
      nodeKind: 'condition',
      yesTargetId: 'yes-1',
      noTargetId: 'no-1',
      successTargetId: 'next',
    },
  },
  {
    id: 'yes-1',
    type: 'tap',
    label: '点击确认',
    flow: { parentConditionId: 'condition', parentBranch: 'yes' },
  },
  {
    id: 'yes-2',
    type: 'delay',
    label: '等待页面',
    timeoutMs: 500,
    flow: { parentConditionId: 'condition', parentBranch: 'yes', successTargetId: 'next' },
  },
  {
    id: 'no-1',
    type: 'key',
    label: '系统返回',
    keyCode: 4,
    flow: { parentConditionId: 'condition', parentBranch: 'no', successTargetId: 'next' },
  },
  { id: 'next', type: 'tap', label: '继续' },
];

const clipboard = createFlowClipboard(steps, [1, 2]);
let sequence = 0;
const pasted = pasteFlowClipboard(steps, clipboard, { afterIndex: 0, branch: 'no' }, () => `copy-${++sequence}`);
const noBranch = pasted.filter((step) => (
  step.flow?.parentConditionId === 'condition' && step.flow.parentBranch === 'no'
));

assert.equal(clipboard.steps.length, 2);
assert.deepEqual(noBranch.map((step) => step.id), ['no-1', 'copy-1', 'copy-2']);
assert.equal(noBranch[0].flow?.successTargetId, 'copy-1');
assert.equal(noBranch[2].flow?.successTargetId, 'next');
assert.equal(pasted.find((step) => step.id === 'condition')?.flow?.noTargetId, 'no-1');

const conditionClipboard = createFlowClipboard(steps, [0]);
assert.deepEqual(conditionClipboard.steps.map((step) => step.id), ['condition', 'yes-1', 'yes-2', 'no-1']);

const conditionWithSelectedChild = createFlowClipboard(steps, [0, 1]);
assert.deepEqual(conditionWithSelectedChild.rootIds, ['condition']);
assert.deepEqual(conditionWithSelectedChild.steps.map((step) => step.id), ['condition', 'yes-1', 'yes-2', 'no-1']);

sequence = 0;
const pastedCondition = pasteFlowClipboard(
  steps,
  conditionClipboard,
  { afterIndex: 0, branch: 'yes' },
  () => `nested-copy-${++sequence}`,
);
const nestedCondition = pastedCondition.find((step) => step.id === 'nested-copy-1');
assert.equal(nestedCondition?.flow?.parentConditionId, 'condition');
assert.equal(nestedCondition?.flow?.parentBranch, 'yes');
assert.equal(nestedCondition?.flow?.yesTargetId, 'nested-copy-2');
assert.equal(nestedCondition?.flow?.noTargetId, 'nested-copy-4');
assert.deepEqual(
  pastedCondition
    .filter((step) => step.flow?.parentConditionId === nestedCondition?.id)
    .map((step) => [step.id, step.flow?.parentBranch]),
  [
    ['nested-copy-2', 'yes'],
    ['nested-copy-3', 'yes'],
    ['nested-copy-4', 'no'],
  ],
);

const nestedLayouts = buildConditionLayouts(pastedCondition);
const rootLayout = nestedLayouts.get('condition');
assert.equal(rootLayout?.yesWidth, 856);
assert.equal(rootLayout?.noWidth, 420);
assert.equal(rootLayout?.totalWidth, 1292);
assert.ok((rootLayout?.yesAxis || 0) < 40);
assert.ok((rootLayout?.noAxis || 100) < 90);

const leafLayout = buildConditionLayouts(steps).get('condition');
assert.ok(leafLayout);
const leftPlacement = placeConditionLayout(leafLayout, 980, 25);
assert.equal(leftPlacement.left, 0);
assert.ok(leftPlacement.yesAxis < 25);
assert.ok(leftPlacement.noAxis < 70);

const childClipboard = createFlowClipboard(steps, [1, 2]);
assert.deepEqual(childClipboard.rootIds, ['yes-1', 'yes-2']);

const branchToMainClipboard = createFlowClipboard(steps, [2, 4]);
assert.deepEqual(branchToMainClipboard.rootIds, ['yes-2', 'next']);

assert.throws(() => createFlowClipboard(steps, [1, 4]), /批量复制只能选择连续节点/);

assert.throws(() => createFlowClipboard([
  { id: 'launch', type: 'launchApp', label: '启动 APP' },
], [0]), /启动 APP 节点不能复制/);

console.log('Appium 流程节点复制与分支粘贴检查通过');
