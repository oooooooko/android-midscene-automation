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

function nextSequentialStep(steps: AppiumRecordedStep[], removed: AppiumRecordedStep, index: number, removedIds: Set<string>) {
  const followingSteps = steps.slice(index + 1).filter((step) => !removedIds.has(step.id));
  if (removed.flow?.parentConditionId && removed.flow.parentBranch) {
    return followingSteps.find((step) => sameBranch(step, removed));
  }
  return followingSteps.find((step) => !step.flow?.parentConditionId);
}

function cleanFlow(flow: NonNullable<AppiumRecordedStep['flow']>) {
  return Object.keys(flow).length ? flow : undefined;
}

export function removeFlowStep(steps: AppiumRecordedStep[], index: number) {
  const removed = steps[index];
  if (!removed) return steps;

  // 分支归属决定删除范围，不能沿跳转连线删除共享的后续节点。
  const removedIds = new Set([removed.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (step.flow?.parentConditionId && removedIds.has(step.flow.parentConditionId) && !removedIds.has(step.id)) {
        removedIds.add(step.id);
        changed = true;
      }
    }
  }
  const sequentialStep = nextSequentialStep(steps, removed, index, removedIds);
  const continuation = steps.find((step) => step.id === removed.flow?.successTargetId && !removedIds.has(step.id));
  const replacementId = continuation?.id || sequentialStep?.id || '';

  return steps
    .filter((step) => !removedIds.has(step.id))
    .map((step) => {
      if (!step.flow) return step;

      const flow = { ...step.flow };
      let changed = false;

      FLOW_TARGET_KEYS.forEach((key) => {
        if (!flow[key] || !removedIds.has(flow[key])) return;
        // 只有指向被点击节点的入口可以接到后续节点，其他子节点引用直接清除。
        if (flow[key] === removed.id && replacementId && replacementId !== step.id) {
          flow[key] = replacementId;
        } else {
          delete flow[key];
        }
        changed = true;
      });

      return changed ? { ...step, flow: cleanFlow(flow) } : step;
    });
}
