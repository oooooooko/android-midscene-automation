import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppiumRecordedStep } from '../../src/appium-recorder/types';
import { BoundedLoopTraversal } from './bounded-loop';

function loopSteps(): AppiumRecordedStep[] {
  return [
    {
      id: 'loop', type: 'loop', label: '检测 3 次', loop: { maxIterations: 3, exitWhen: 'never' },
      flow: { nodeKind: 'condition', yesTargetId: 'first', noTargetId: 'after' },
    },
    {
      id: 'first', type: 'log', label: '本轮开始',
      flow: { nodeKind: 'action', parentConditionId: 'loop', parentBranch: 'yes', successTargetId: 'continue' },
    },
    {
      id: 'continue', type: 'continueLoop', label: '继续下一次循环', continueLoopTargetId: 'loop',
      flow: { nodeKind: 'action', parentConditionId: 'loop', parentBranch: 'yes', successTargetId: 'skipped' },
    },
    {
      id: 'skipped', type: 'log', label: '应跳过',
      flow: { nodeKind: 'action', parentConditionId: 'loop', parentBranch: 'yes' },
    },
    { id: 'after', type: 'log', label: '循环后续', flow: { nodeKind: 'action' } },
  ];
}

test('继续下一次循环会跳过本轮剩余节点，达到上限后执行后续', () => {
  const steps = loopSteps();
  const traversal = new BoundedLoopTraversal(steps);
  const loop = steps[0]!;
  const continueStep = steps[2]!;

  for (let expectedIteration = 1; expectedIteration <= 3; expectedIteration += 1) {
    traversal.visit(loop);
    const entered = traversal.enter(loop);
    assert.equal(entered.iteration, expectedIteration);
    assert.equal(entered.next, 1);
    traversal.visit(steps[1]!);
    traversal.visit(continueStep);
    const continued = traversal.continue(continueStep);
    assert.equal(continued.next, 0);
    assert.equal(continued.iteration, expectedIteration);
  }

  traversal.visit(loop);
  assert.equal(traversal.iteration(loop), 3);
  assert.equal(traversal.exit(loop), 4);
});

test('继续循环的目标必须是当前节点所属循环', () => {
  const steps = loopSteps();
  steps[2] = { ...steps[2]!, continueLoopTargetId: 'missing' };
  assert.throws(() => new BoundedLoopTraversal(steps), /继续循环目标/);
});
