import type { AppiumRecordedStep } from './types';

type FlowTargetKey = 'yesTargetId' | 'noTargetId' | 'successTargetId' | 'failureTargetId';

const FLOW_TARGET_KEYS: FlowTargetKey[] = ['yesTargetId', 'noTargetId', 'successTargetId', 'failureTargetId'];

function sameBranch(step: AppiumRecordedStep, removed: AppiumRecordedStep) {
  return Boolean(
    removed.flow?.parentConditionId
    && removed.flow?.parentBranch
    && step.flow?.parentConditionId === removed.flow.parentConditionId
    && step.flow?.parentBranch === removed.flow.parentBranch,
  );
}

function nextSequentialStep(steps: AppiumRecordedStep[], removed: AppiumRecordedStep, index: number) {
  if (removed.flow?.parentConditionId && removed.flow.parentBranch) {
    return steps.slice(index + 1).find((step) => sameBranch(step, removed));
  }
  return steps.slice(index + 1).find((step) => !step.flow?.parentConditionId);
}

function cleanFlow(flow: NonNullable<AppiumRecordedStep['flow']>) {
  return Object.keys(flow).length ? flow : undefined;
}

export function removeFlowStep(steps: AppiumRecordedStep[], index: number) {
  const removed = steps[index];
  if (!removed) return steps;

  const sequentialStep = nextSequentialStep(steps, removed, index);
  const replacementId = removed.flow?.successTargetId || sequentialStep?.id || '';
  const removedParentConditionId = removed.flow?.parentConditionId;
  const removedParentBranch = removed.flow?.parentBranch;

  return steps
    .filter((_step, stepIndex) => stepIndex !== index)
    .map((step) => {
      if (!step.flow) return step;

      const flow = { ...step.flow };
      let changed = false;

      FLOW_TARGET_KEYS.forEach((key) => {
        if (flow[key] !== removed.id) return;
        if (replacementId) {
          flow[key] = replacementId;
        } else {
          delete flow[key];
        }
        changed = true;
      });

      if (flow.parentConditionId === removed.id) {
        if (removedParentConditionId && removedParentBranch) {
          flow.parentConditionId = removedParentConditionId;
          flow.parentBranch = removedParentBranch;
        } else {
          delete flow.parentConditionId;
          delete flow.parentBranch;
        }
        changed = true;
      }

      return changed ? { ...step, flow: cleanFlow(flow) } : step;
    });
}
