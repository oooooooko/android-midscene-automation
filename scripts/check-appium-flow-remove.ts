import assert from 'node:assert/strict';
import { removeFlowStep } from '../src/appium-recorder/flow-remove';
import { normalizeLegacyNestedConditionBranches } from '../src/appium-recorder/flow-normalize';
import type { AppiumRecordedStep } from '../src/appium-recorder/types';

const steps: AppiumRecordedStep[] = [
  { id: 'outer', type: 'assertExists', label: '上一级判断', flow: { nodeKind: 'condition', yesTargetId: 'inner', noTargetId: 'other' } },
  { id: 'inner', type: 'assertExists', label: '删除此判断', flow: { nodeKind: 'condition', parentConditionId: 'outer', parentBranch: 'yes', yesTargetId: 'input', noTargetId: 'wait', successTargetId: 'after' } },
  { id: 'input', type: 'input', label: '输入', flow: { parentConditionId: 'inner', parentBranch: 'yes', successTargetId: 'nested' } },
  { id: 'wait', type: 'waitFor', label: '等待出现', flow: { parentConditionId: 'inner', parentBranch: 'no' } },
  { id: 'nested', type: 'aiRecognition', label: '更深判断', flow: { parentConditionId: 'inner', parentBranch: 'yes', yesTargetId: 'deep', noTargetId: 'after' } },
  { id: 'deep', type: 'noop', label: '深层子节点', flow: { parentConditionId: 'nested', parentBranch: 'yes', successTargetId: 'after' } },
  { id: 'other', type: 'noop', label: '外层另一分支', flow: { parentConditionId: 'outer', parentBranch: 'no', failureTargetId: 'deep' } },
  { id: 'after', type: 'noop', label: '同级后续', flow: { parentConditionId: 'outer', parentBranch: 'yes', successTargetId: 'main' } },
  { id: 'main', type: 'noop', label: '公共后续' },
];
const original = JSON.stringify(steps);
const result = removeFlowStep(steps, 1);
assert.deepEqual(result.map((step) => step.id), ['outer', 'other', 'after', 'main']);
assert.equal(result[0].flow?.yesTargetId, 'after');
assert.equal(result[0].flow?.noTargetId, 'other');
assert.equal(result[1].flow?.failureTargetId, undefined);
assert.equal(result[1].flow?.parentBranch, 'no');
assert.equal(JSON.stringify(steps), original, 'Deletion must not mutate the input');
assert.deepEqual(normalizeLegacyNestedConditionBranches(result), result, 'Saving/reloading must not reassign surviving nodes');

// The screenshot case: deleting the nested condition leaves its parent branch empty.
const screenshotCase = steps.slice(0, 4).map((step) => ({ ...step, flow: { ...step.flow, successTargetId: undefined } }));
const screenshotResult = removeFlowStep(screenshotCase, 1);
assert.deepEqual(screenshotResult.map((step) => step.id), ['outer']);
assert.equal(screenshotResult[0].flow?.yesTargetId, undefined);

// A missing/invalid continuation must never reconnect to a deleted descendant.
for (const target of [undefined, 'deep', 'missing']) {
  const variant = steps.map((step) => step.id === 'inner' ? { ...step, flow: { ...step.flow, successTargetId: target } } : step);
  assert.equal(removeFlowStep(variant, 1)[0].flow?.yesTargetId, 'after');
}
assert.deepEqual(removeFlowStep(steps, 0).map((step) => step.id), ['main']);
assert.equal(removeFlowStep(steps, -1), steps);
const sequential = removeFlowStep(steps, 2);
assert.equal(sequential.find((step) => step.id === 'inner')?.flow?.yesTargetId, 'nested');
assert.ok(sequential.some((step) => step.id === 'wait'));
assert.ok(sequential.some((step) => step.id === 'deep'));

for (const type of ['checkboxState', 'radioButtonState', 'aiRecognition'] as const) {
  const variant = steps.map((step) => step.id === 'inner' ? { ...step, type } : step);
  assert.deepEqual(removeFlowStep(variant, 1).map((step) => step.id), result.map((step) => step.id));
}
// Child records need not appear after their parent in serialized scripts.
const shuffled = [steps[5], ...steps.filter((step) => step.id !== 'deep')];
assert.ok(!removeFlowStep(shuffled, 2).some((step) => step.id === 'deep'));
console.log('PASS: cascading condition deletion, nested/boolean branches, continuations, dangling references, ordinary deletion and immutable input');
