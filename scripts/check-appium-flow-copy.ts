import assert from 'node:assert/strict';
import { createFlowClipboard, pasteFlowClipboard } from '../src/appium-recorder/flow-copy';
import { buildFlowGraph } from '../src/appium-recorder/flow-graph';
import { buildConditionLayouts, placeConditionLayout } from '../src/appium-recorder/flow-layout';
import { labelFlowStep } from '../src/appium-recorder/flow-labels';
import { normalizeLegacyNestedConditionBranches } from '../src/appium-recorder/flow-normalize';
import { removeFlowStep } from '../src/appium-recorder/flow-remove';
import { findOpenVisualChangeStart } from '../src/appium-recorder/visual-change-pairs';
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
assert.deepEqual(noBranch.map((step) => step.id), ['copy-1', 'copy-2', 'no-1']);
assert.equal(noBranch[1].flow?.successTargetId, 'no-1');
assert.equal(noBranch[2].flow?.successTargetId, 'next');
assert.equal(pasted.find((step) => step.id === 'condition')?.flow?.noTargetId, 'copy-1');

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

const nestedTargetSteps: AppiumRecordedStep[] = [
  {
    id: 'outer',
    type: 'assertExists',
    label: '外层判断',
    flow: { nodeKind: 'condition', yesTargetId: 'inner' },
  },
  {
    id: 'inner',
    type: 'assertExists',
    label: '内层判断',
    flow: {
      nodeKind: 'condition',
      parentConditionId: 'outer',
      parentBranch: 'yes',
    },
  },
  {
    id: 'source',
    type: 'delay',
    label: '待复制节点',
    timeoutMs: 300,
  },
];
const nestedBranchClipboard = createFlowClipboard(nestedTargetSteps, [2]);
sequence = 0;
const pastedIntoNestedBranch = pasteFlowClipboard(
  nestedTargetSteps,
  nestedBranchClipboard,
  { afterIndex: 1, branch: 'yes' },
  () => `nested-target-copy-${++sequence}`,
);
const nestedBranchCopy = pastedIntoNestedBranch.find((step) => step.id === 'nested-target-copy-1');
assert.equal(nestedBranchCopy?.flow?.parentConditionId, 'inner');
assert.equal(nestedBranchCopy?.flow?.parentBranch, 'yes');
assert.equal(pastedIntoNestedBranch.find((step) => step.id === 'inner')?.flow?.yesTargetId, 'nested-target-copy-1');
assert.equal(pastedIntoNestedBranch.find((step) => step.id === 'outer')?.flow?.yesTargetId, 'inner');

const visualReferenceSteps: AppiumRecordedStep[] = [
  {
    id: 'visual-start',
    type: 'visualChange',
    label: '检测画面变化1-开始节点',
    flow: { nodeKind: 'assertion' },
    visualChange: {
      mode: 'region',
      region: { x: 0, y: 0, width: 100, height: 100 },
      role: 'start',
      pairId: 'pair-1',
      pairLabel: '检测画面变化1',
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'visual-end',
    type: 'visualChange',
    label: '检测画面变化1-结束节点',
    flow: { nodeKind: 'assertion' },
    visualChange: {
      mode: 'region',
      region: { x: 0, y: 0, width: 100, height: 100 },
      role: 'end',
      pairId: 'pair-1',
      pairLabel: '检测画面变化1',
      startStepId: 'visual-start',
      endStepId: 'visual-end',
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
];
sequence = 0;
const pastedVisualReferences = pasteFlowClipboard(
  visualReferenceSteps,
  createFlowClipboard(visualReferenceSteps, [0, 1]),
  { afterIndex: 1 },
  () => `visual-copy-${++sequence}`,
);
const pastedVisualStart = pastedVisualReferences.find((step) => step.id === 'visual-copy-1');
const pastedVisualCheck = pastedVisualReferences.find((step) => step.id === 'visual-copy-2');
assert.equal(pastedVisualStart?.visualChange?.pairId, 'visual-copy-3');
assert.equal(pastedVisualCheck?.visualChange?.pairId, 'visual-copy-3');
assert.equal(pastedVisualCheck?.visualChange?.startStepId, 'visual-copy-1');
assert.equal(pastedVisualCheck?.visualChange?.endStepId, 'visual-copy-2');
assert.equal(findOpenVisualChangeStart(visualReferenceSteps, 1), undefined);

const legacyVisualEndSteps: AppiumRecordedStep[] = [
  {
    id: 'legacy-visual-start',
    type: 'visualChange',
    label: '检测画面变化7-开始节点',
    flow: { nodeKind: 'assertion' },
    visualChange: {
      mode: 'region',
      role: 'start',
      pairId: '',
      pairLabel: '检测画面变化7',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'legacy-visual-end',
    type: 'visualChange',
    label: '检测画面变化7-结束节点',
    flow: { nodeKind: 'assertion' },
    visualChange: {
      mode: 'region',
      role: 'end',
      pairId: '',
      pairLabel: '检测画面变化7',
      startStepId: 'legacy-visual-start',
      endStepId: 'legacy-visual-end',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
];
assert.equal(findOpenVisualChangeStart(legacyVisualEndSteps, 1), undefined);

const partiallyLinkedVisualEndSteps: AppiumRecordedStep[] = [
  {
    id: 'partial-visual-start-1',
    type: 'visualChange',
    label: '检测画面变化1-开始节点',
    visualChange: {
      mode: 'region',
      role: 'start',
      pairId: 'partial-pair-1',
      pairLabel: '检测画面变化1',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  { id: 'partial-tap', type: 'tap', label: '点击' },
  {
    id: 'partial-visual-start-2',
    type: 'visualChange',
    label: '检测画面变化2-开始节点',
    visualChange: {
      mode: 'region',
      role: 'start',
      pairId: 'partial-pair-2',
      pairLabel: '检测画面变化2',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'partial-visual-end-2',
    type: 'visualChange',
    label: '检测画面变化2-结束节点',
    visualChange: {
      mode: 'region',
      role: 'end',
      pairId: 'partial-pair-2',
      pairLabel: '检测画面变化2',
      startStepId: 'partial-visual-start-2',
      endStepId: 'partial-visual-end-2',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'partial-visual-end-1',
    type: 'visualChange',
    label: '检测画面变化1-结束节点',
    visualChange: {
      mode: 'region',
      role: 'end',
      pairId: '',
      pairLabel: '检测画面变化1',
      startStepId: '',
      endStepId: 'partial-visual-end-1',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  { id: 'partial-input', type: 'input', label: '输入' },
];
assert.equal(findOpenVisualChangeStart(partiallyLinkedVisualEndSteps, 5), undefined);
assert.throws(
  () => createFlowClipboard(partiallyLinkedVisualEndSteps, [4]),
  /检测画面变化结束节点不能单独复制/,
);

const visualBranchPairSteps: AppiumRecordedStep[] = [
  {
    id: 'main-start',
    type: 'visualChange',
    label: '检测画面变化1-开始节点',
    visualChange: {
      mode: 'region',
      role: 'start',
      pairId: 'main-pair',
      pairLabel: '检测画面变化1',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'condition',
    type: 'assertExists',
    label: '判断存在',
    flow: { nodeKind: 'condition', yesTargetId: 'yes-start', noTargetId: 'no-start' },
  },
  {
    id: 'yes-start',
    type: 'visualChange',
    label: '检测画面变化2-开始节点',
    flow: { nodeKind: 'assertion', parentConditionId: 'condition', parentBranch: 'yes' },
    visualChange: {
      mode: 'region',
      role: 'start',
      pairId: 'yes-pair',
      pairLabel: '检测画面变化2',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'yes-end',
    type: 'visualChange',
    label: '检测画面变化2-结束节点',
    flow: { nodeKind: 'assertion', parentConditionId: 'condition', parentBranch: 'yes' },
    visualChange: {
      mode: 'region',
      role: 'end',
      pairId: 'yes-pair',
      pairLabel: '检测画面变化2',
      startStepId: 'yes-start',
      endStepId: 'yes-end',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'no-start',
    type: 'visualChange',
    label: '检测画面变化3-开始节点',
    flow: { nodeKind: 'assertion', parentConditionId: 'condition', parentBranch: 'no' },
    visualChange: {
      mode: 'region',
      role: 'start',
      pairId: 'no-pair',
      pairLabel: '检测画面变化3',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
];
assert.equal(
  findOpenVisualChangeStart(visualBranchPairSteps, 1, { stepId: 'condition', branch: 'yes' })?.id,
  'main-start',
);
assert.equal(
  findOpenVisualChangeStart(visualBranchPairSteps, 2, { stepId: 'condition', branch: 'yes' })?.id,
  'main-start',
);
assert.equal(
  findOpenVisualChangeStart(visualBranchPairSteps, 4, { stepId: 'condition', branch: 'no' })?.id,
  'no-start',
);
assert.equal(
  findOpenVisualChangeStart(visualBranchPairSteps.filter((step) => step.id !== 'main-start'), 3, { stepId: 'condition', branch: 'no' })?.id,
  'no-start',
);
const rootVisualStartOnly = visualBranchPairSteps.filter((step) => (
  !['yes-start', 'yes-end', 'no-start'].includes(step.id)
));
assert.equal(
  findOpenVisualChangeStart(rootVisualStartOnly, 1, { stepId: 'condition', branch: 'yes' })?.id,
  'main-start',
);
assert.equal(
  findOpenVisualChangeStart(rootVisualStartOnly, 1, { stepId: 'condition', branch: 'no' })?.id,
  'main-start',
);
const yesVisualStartOnly = visualBranchPairSteps.filter((step) => (
  !['main-start', 'yes-end', 'no-start'].includes(step.id)
));
assert.equal(
  findOpenVisualChangeStart(yesVisualStartOnly, 1, { stepId: 'condition', branch: 'yes' })?.id,
  'yes-start',
);
assert.equal(
  findOpenVisualChangeStart(yesVisualStartOnly, 1, { stepId: 'condition', branch: 'no' })?.id,
  undefined,
);

const branchContinuationVisualSteps: AppiumRecordedStep[] = [
  {
    id: 'condition-2',
    type: 'assertExists',
    label: '判断存在',
    flow: { nodeKind: 'condition', yesTargetId: 'branch-start' },
  },
  {
    id: 'branch-start',
    type: 'visualChange',
    label: '检测画面变化4-开始节点',
    flow: {
      nodeKind: 'assertion',
      parentConditionId: 'condition-2',
      parentBranch: 'yes',
      successTargetId: 'branch-tap',
    },
    visualChange: {
      mode: 'region',
      role: 'start',
      pairId: 'branch-pair',
      pairLabel: '检测画面变化4',
      region: { x: 0, y: 0, width: 10, height: 10 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'branch-tap',
    type: 'tap',
    label: '点击',
    flow: {
      parentConditionId: 'condition-2',
      parentBranch: 'yes',
      successTargetId: 'main-input',
    },
  },
  {
    id: 'main-input',
    type: 'input',
    label: '输入',
  },
];
assert.equal(
  findOpenVisualChangeStart(branchContinuationVisualSteps, 3)?.id,
  'branch-start',
);
const ambiguousContinuationVisualSteps: AppiumRecordedStep[] = [
  {
    ...branchContinuationVisualSteps[0],
    flow: {
      nodeKind: 'condition',
      yesTargetId: 'branch-start',
      noTargetId: 'main-input',
    },
  },
  ...branchContinuationVisualSteps.slice(1),
];
assert.equal(
  findOpenVisualChangeStart(ambiguousContinuationVisualSteps, 3)?.id,
  undefined,
);

const repairedLegacyNestedBranch = normalizeLegacyNestedConditionBranches([
  {
    id: 'outer-condition',
    type: 'assertExists',
    label: '外层判断',
    flow: { nodeKind: 'condition', yesTargetId: 'outer-action' },
  },
  {
    id: 'outer-action',
    type: 'tap',
    label: '外层分支操作',
    flow: { parentConditionId: 'outer-condition', parentBranch: 'yes' },
  },
  {
    id: 'inner-condition',
    type: 'assertExists',
    label: '内层判断',
    flow: { nodeKind: 'condition', parentConditionId: 'outer-condition', parentBranch: 'yes' },
  },
  {
    id: 'misnested-action-1',
    type: 'tap',
    label: '错误挂在外层的操作 1',
    flow: { parentConditionId: 'outer-condition', parentBranch: 'yes' },
  },
  {
    id: 'misnested-action-2',
    type: 'tap',
    label: '错误挂在外层的操作 2',
    flow: { parentConditionId: 'outer-condition', parentBranch: 'yes' },
  },
]);
assert.equal(
  repairedLegacyNestedBranch.find((step) => step.id === 'inner-condition')?.flow?.yesTargetId,
  'misnested-action-1',
);
assert.equal(
  repairedLegacyNestedBranch.find((step) => step.id === 'misnested-action-1')?.flow?.parentConditionId,
  'inner-condition',
);
assert.equal(
  repairedLegacyNestedBranch.find((step) => step.id === 'misnested-action-2')?.flow?.parentConditionId,
  'inner-condition',
);
assert.equal(repairedLegacyNestedBranch.find((step) => step.id === 'outer-condition')?.flow?.yesTargetId, 'outer-action');

const validNestedBranch: AppiumRecordedStep[] = [
  {
    id: 'valid-outer',
    type: 'assertExists',
    label: '外层判断',
    flow: { nodeKind: 'condition', yesTargetId: 'valid-inner' },
  },
  {
    id: 'valid-inner',
    type: 'assertExists',
    label: '已有分支的内层判断',
    flow: {
      nodeKind: 'condition',
      parentConditionId: 'valid-outer',
      parentBranch: 'yes',
      yesTargetId: 'valid-child',
    },
  },
  {
    id: 'valid-child',
    type: 'tap',
    label: '内层分支操作',
    flow: { parentConditionId: 'valid-inner', parentBranch: 'yes' },
  },
];
assert.equal(normalizeLegacyNestedConditionBranches(validNestedBranch), validNestedBranch);

const deletedVisualChangeSteps = removeFlowStep([
  {
    id: 'popup-condition',
    type: 'assertExists',
    label: '判断是否存在协议',
    flow: {
      nodeKind: 'condition',
      yesTargetId: 'confirm-button',
      noTargetId: '',
    },
  },
  {
    id: 'confirm-button',
    type: 'tap',
    label: '用户协议框确认按钮',
    flow: {
      parentConditionId: 'popup-condition',
      parentBranch: 'yes',
      successTargetId: 'visual-change',
    },
  },
  {
    id: 'visual-change',
    type: 'visualChange',
    label: '检测画面变化 区域',
    flow: {
      nodeKind: 'assertion',
      parentConditionId: 'popup-condition',
      parentBranch: 'yes',
      successTargetId: 'account-input',
    },
    visualChange: {
      mode: 'region',
      region: { x: 0, y: 0, width: 100, height: 100 },
      durationMs: 5000,
      intervalMs: 1000,
      changeRatioThreshold: 2,
      pixelmatchThreshold: 0.1,
    },
  },
  {
    id: 'account-input',
    type: 'input',
    label: '输入账号',
  },
], 2);
assert.equal(
  deletedVisualChangeSteps.find((step) => step.id === 'confirm-button')?.flow?.successTargetId,
  'account-input',
);
assert.equal(
  deletedVisualChangeSteps.find((step) => step.id === 'popup-condition')?.flow?.noTargetId,
  '',
);
assert.equal(
  deletedVisualChangeSteps.find((step) => step.id === 'account-input')?.flow?.parentBranch,
  undefined,
);
const deletedVisualChangeGraph = buildFlowGraph(deletedVisualChangeSteps, {
  expandedStepIndex: null,
  selectedCopyIndexes: [],
  copyMode: false,
  disabled: false,
  removeDisabled: false,
  clipboardCount: 0,
  canOpenInsertMenu: true,
  isStartActionDisabled: () => false,
  isInsertActionDisabled: () => false,
  isAppExecutionDisabled: () => false,
  startActionGroups: [],
  mainActionGroups: [],
  measuredNodeHeights: {},
  labelStep: labelFlowStep,
  isCopySelected: () => false,
});
const deletedVisualNodeById = new Map(deletedVisualChangeGraph.nodes.map((node) => [node.id, node]));
const confirmNode = deletedVisualNodeById.get('step:confirm-button');
const accountNode = deletedVisualNodeById.get('step:account-input');
assert.ok(confirmNode && accountNode);
assert.equal(
  Math.round(confirmNode.position.x + Number(confirmNode.width) / 2),
  Math.round(accountNode.position.x + Number(accountNode.width) / 2),
);
assert.ok(accountNode.position.y > confirmNode.position.y);

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

const nestedBranchLayoutSteps: AppiumRecordedStep[] = [
  {
    id: 'layout-outer',
    type: 'assertExists',
    label: '判断是否存在权限弹窗',
    flow: { nodeKind: 'condition', yesTargetId: 'layout-yes-1', noTargetId: 'layout-no-1' },
  },
  {
    id: 'layout-yes-1',
    type: 'tap',
    label: '点击允许发送通知',
    flow: { parentConditionId: 'layout-outer', parentBranch: 'yes' },
  },
  {
    id: 'layout-inner',
    type: 'assertExists',
    label: '判断是否存在声明与条款',
    flow: {
      nodeKind: 'condition',
      parentConditionId: 'layout-outer',
      parentBranch: 'yes',
      yesTargetId: 'layout-inner-yes-1',
      noTargetId: 'layout-inner-no-1',
    },
  },
  {
    id: 'layout-inner-yes-1',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/button_with_text',
    flow: { parentConditionId: 'layout-inner', parentBranch: 'yes' },
  },
  {
    id: 'layout-inner-yes-2',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/btn_pos',
    flow: { parentConditionId: 'layout-inner', parentBranch: 'yes' },
  },
  {
    id: 'layout-inner-no-1',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/remember_password_checkbox',
    flow: { parentConditionId: 'layout-inner', parentBranch: 'no' },
  },
  {
    id: 'layout-inner-no-2',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/remember_password_checkbox',
    flow: { parentConditionId: 'layout-inner', parentBranch: 'no' },
  },
  {
    id: 'layout-no-1',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/rl_right',
    flow: { parentConditionId: 'layout-outer', parentBranch: 'no' },
  },
  {
    id: 'layout-no-2',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/remember_password_checkbox',
    flow: { parentConditionId: 'layout-outer', parentBranch: 'no' },
  },
  {
    id: 'layout-no-3',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/remember_password_checkbox',
    flow: { parentConditionId: 'layout-outer', parentBranch: 'no' },
  },
  {
    id: 'layout-no-4',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/remember_password_checkbox',
    flow: { parentConditionId: 'layout-outer', parentBranch: 'no' },
  },
  {
    id: 'layout-no-5',
    type: 'tap',
    label: '点击 com.tange365.icam365:id/remember_password_checkbox',
    flow: { parentConditionId: 'layout-outer', parentBranch: 'no' },
  },
];
const nestedBranchGraph = buildFlowGraph(nestedBranchLayoutSteps, {
  expandedStepIndex: null,
  selectedCopyIndexes: [],
  copyMode: false,
  disabled: false,
  removeDisabled: false,
  clipboardCount: 0,
  canOpenInsertMenu: true,
  isStartActionDisabled: () => false,
  isInsertActionDisabled: () => false,
  isAppExecutionDisabled: () => false,
  startActionGroups: [],
  mainActionGroups: [],
  measuredNodeHeights: {},
  labelStep: labelFlowStep,
  isCopySelected: () => false,
});
const nestedLayoutNodeById = new Map(nestedBranchGraph.nodes.map((node) => [node.id, node]));
const nestedNodeCenterX = (id: string) => {
  const node = nestedLayoutNodeById.get(id);
  assert.ok(node, `${id} should exist in nested branch graph`);
  return node.position.x + Number(node.width) / 2;
};
const outerCenter = nestedNodeCenterX('step:layout-outer');
const outerYesCenter = nestedNodeCenterX('branch:layout-outer:yes');
const outerNoCenter = nestedNodeCenterX('branch:layout-outer:no');
assert.equal(Math.round((outerYesCenter + outerNoCenter) / 2), Math.round(outerCenter));
assert.ok(
  outerNoCenter - outerYesCenter > 520,
  'outer condition should expand its branch width for nested child branches',
);
const innerCenter = nestedNodeCenterX('step:layout-inner');
const innerYesCenter = nestedNodeCenterX('branch:layout-inner:yes');
const innerNoCenter = nestedNodeCenterX('branch:layout-inner:no');
assert.equal(Math.round((innerYesCenter + innerNoCenter) / 2), Math.round(innerCenter));

const nestedStepNodes = nestedBranchGraph.nodes.filter((node) => node.data?.kind === 'step');
for (let leftIndex = 0; leftIndex < nestedStepNodes.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < nestedStepNodes.length; rightIndex += 1) {
    const left = nestedStepNodes[leftIndex];
    const right = nestedStepNodes[rightIndex];
    const xOverlap = Math.min(left.position.x + Number(left.width), right.position.x + Number(right.width))
      - Math.max(left.position.x, right.position.x);
    const yOverlap = Math.min(left.position.y + Number(left.height), right.position.y + Number(right.height))
      - Math.max(left.position.y, right.position.y);
    assert.ok(
      xOverlap <= 4 || yOverlap <= 4,
      `${left.id} should not overlap ${right.id}`,
    );
  }
}

assert.throws(() => createFlowClipboard(steps, [1, 4]), /批量复制只能选择连续节点/);

assert.throws(() => createFlowClipboard([
  { id: 'launch', type: 'launchApp', label: '启动 APP' },
], [0]), /启动 APP 节点不能复制/);

console.log('Appium 流程节点复制与分支粘贴检查通过');
