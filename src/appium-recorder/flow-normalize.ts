import type { AppiumRecordedStep } from './types';
import { isBooleanCondition } from './flow-labels';

type BranchName = 'yes' | 'no';

function isCondition(step: AppiumRecordedStep) {
  return step.flow?.nodeKind === 'condition';
}

function isEmptyNestedCondition(step: AppiumRecordedStep) {
  return isCondition(step)
    // 新类型不存在旧版分支数据，不应把后续同级节点迁入 true 分支。
    && !isBooleanCondition(step)
    && step.type !== 'loop'
    && Boolean(step.flow?.parentConditionId)
    && Boolean(step.flow?.parentBranch)
    && !step.flow?.yesTargetId
    && !step.flow?.noTargetId
    && !step.flow?.successTargetId;
}

function sameParentBranch(step: AppiumRecordedStep, parentConditionId: string, parentBranch: BranchName) {
  return step.flow?.parentConditionId === parentConditionId
    && step.flow?.parentBranch === parentBranch;
}

export function normalizeLegacyNestedConditionBranches<T extends AppiumRecordedStep>(steps: T[]) {
  // 清理旧脚本已移除的可选步骤设置，避免继续导出或保存失效字段。
  const nextSteps = steps.map((step) => {
    if (!('optional' in step)) return step;
    const next = { ...step };
    Reflect.deleteProperty(next, 'optional');
    return next;
  });
  let changed = nextSteps.some((step, index) => step !== steps[index]);

  for (let index = 0; index < nextSteps.length; index += 1) {
    const condition = nextSteps[index];
    if (!condition || !isEmptyNestedCondition(condition)) continue;

    const parentConditionId = condition.flow?.parentConditionId || '';
    const parentBranch = condition.flow?.parentBranch;
    if (!parentConditionId || !parentBranch) continue;

    const childIndexes: number[] = [];
    for (let childIndex = index + 1; childIndex < nextSteps.length; childIndex += 1) {
      if (!sameParentBranch(nextSteps[childIndex], parentConditionId, parentBranch)) break;
      childIndexes.push(childIndex);
    }
    if (!childIndexes.length) continue;

    const firstChild = nextSteps[childIndexes[0]];
    nextSteps[index] = {
      ...condition,
      flow: {
        ...(condition.flow || {}),
        nodeKind: 'condition',
        yesTargetId: firstChild.id,
      },
    };

    childIndexes.forEach((childIndex) => {
      const child = nextSteps[childIndex];
      nextSteps[childIndex] = {
        ...child,
        flow: {
          ...(child.flow || {}),
          parentConditionId: condition.id,
          parentBranch: 'yes',
        },
      };
    });
    changed = true;
  }

  return changed ? nextSteps : steps;
}
