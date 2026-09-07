import assert from 'node:assert/strict';
import { mergeBranches } from '../src/appium-recorder/flow-merge';
import { buildFlowGraph } from '../src/appium-recorder/flow-graph';
import { labelFlowStep } from '../src/appium-recorder/flow-labels';
import { removeFlowStep } from '../src/appium-recorder/flow-remove';
import { createFlowClipboard, pasteFlowClipboard } from '../src/appium-recorder/flow-copy';
import { normalizeLegacyNestedConditionBranches } from '../src/appium-recorder/flow-normalize';
import type { AppiumRecordedStep } from '../src/appium-recorder/types';

const options = { expandedStepIndex: null, selectedCopyIndexes: [], copyMode: false, canOpenInsertMenu: true,
  isStartActionDisabled: () => false, isInsertActionDisabled: () => false, isAppExecutionDisabled: () => false,
  startActionGroups: [], mainActionGroups: [], labelStep: labelFlowStep, isCopySelected: () => false };
for (const type of ['assertExists', 'checkedState', 'textClick', 'aiRecognition'] as const) {
  const input: AppiumRecordedStep[] = [
    { id: 'c', type, label: '判断', flow: { nodeKind: 'condition', yesTargetId: 'a', noTargetId: 'duplicate' } },
    { id: 'a', type: 'log', label: '独有操作', flow: { parentConditionId: 'c', parentBranch: 'yes' } },
    { id: 'common', type: 'log', label: '公共操作', flow: { parentConditionId: 'c', parentBranch: 'yes' } },
    { id: 'last', type: 'log', label: '公共后续', flow: { parentConditionId: 'c', parentBranch: 'yes' } },
    { id: 'duplicate', type: 'log', label: '待删除重复', flow: { parentConditionId: 'c', parentBranch: 'no' } },
  ];
  const original = JSON.stringify(input);
  const { steps, removedCount } = mergeBranches(input, 'c', 'common', 'duplicate');
  assert.equal(JSON.stringify(input), original);
  assert.equal(removedCount, 1);
  assert.deepEqual(steps.map((step) => step.id), ['c', 'a', 'common', 'last']);
  assert.equal(steps[0].flow?.noTargetId, 'common');
  assert.equal(steps[1].flow?.successTargetId, 'common');
  assert.equal(steps[2].flow?.parentConditionId, undefined);
  assert.deepEqual(normalizeLegacyNestedConditionBranches(steps), steps);
  assert.deepEqual(removeFlowStep(steps, 1).map((step) => step.id), ['c', 'common', 'last']);
  assert.deepEqual(removeFlowStep(steps, 0).map((step) => step.id), ['common', 'last']);
  const deletedCommon = removeFlowStep(steps, 2);
  assert.equal(deletedCommon[0].flow?.successTargetId, 'last');
  assert.equal(deletedCommon[1].flow?.successTargetId, 'last');
  let id = 0;
  const pasted = pasteFlowClipboard([], createFlowClipboard(steps, [0, 2, 3]), { afterIndex: -1 }, () => `new-${++id}`);
  assert.equal(pasted[0].flow?.successTargetId, pasted.find((step) => step.label === '公共操作')?.id);
  const graph = buildFlowGraph(steps, options);
  const find = (id: string) => graph.nodes.find((node) => node.data.kind === 'step' && node.data.step.id === id)!;
  assert.equal(find('c').position.x, find('common').position.x);
  assert.ok(find('common').position.y > find('a').position.y + Number(find('a').height));
  assert.equal(graph.edges.filter((edge) => edge.target === find('common').id).length, 2);
  assert.throws(() => mergeBranches(steps, 'c', 'a'), /已有/);
  assert.throws(() => mergeBranches(input, 'c', 'common', 'a'), /另一侧/);
  const kept = mergeBranches(input, 'c', 'common').steps;
  assert.equal(kept.find((step) => step.id === 'duplicate')?.flow?.successTargetId, 'common');
  const fromRight = mergeBranches(input, 'c', 'duplicate', 'common').steps;
  assert.deepEqual(fromRight.map((step) => step.id), ['c', 'a', 'duplicate']);
  assert.equal(fromRight[1].flow?.successTargetId, 'duplicate');
  assert.equal(fromRight[2].flow?.parentConditionId, undefined);
  const cyclic = input.map((step) => step.id === 'last' ? { ...step, flow: { ...step.flow, successTargetId: 'a' } } : step);
  assert.throws(() => mergeBranches(cyclic, 'c', 'common'), /循环/);
  const nested = input.map((step) => step.id === 'c' ? { ...step, flow: { ...step.flow, parentConditionId: 'outer', parentBranch: 'yes' as const } } : step);
  nested.unshift({ id: 'outer', type, label: '外层', flow: { nodeKind: 'condition', yesTargetId: 'c' } });
  const merged = mergeBranches(nested, 'c', 'common', 'duplicate').steps;
  assert.equal(merged.find((step) => step.id === 'common')?.flow?.parentConditionId, 'outer');
  const nestedGraph = buildFlowGraph(merged, options);
  const nc = nestedGraph.nodes.find((node) => node.data.kind === 'step' && node.data.step.id === 'common')!;
  assert.equal(nestedGraph.edges.filter((edge) => edge.target === nc.id).length, 2);
}
console.log('PASS: merge ownership, immutable edits, duplicate deletion, nested branches, shared layout, copy/delete and validation');
