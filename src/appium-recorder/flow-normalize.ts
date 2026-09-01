import type { AppiumRecordedStep } from './types';

type BranchName = 'yes' | 'no';

function isCondition(step: AppiumRecordedStep) {
  return step.flow?.nodeKind === 'condition';
}

function isEmptyNestedCondition(step: AppiumRecordedStep) {
  return isCondition(step)
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
  const nextSteps = [...steps];
  let changed = false;

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
