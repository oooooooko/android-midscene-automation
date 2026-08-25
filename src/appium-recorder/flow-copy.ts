import type { AppiumRecordedStep } from './types';

export type FlowBranch = 'yes' | 'no';

export type FlowClipboard = {
  steps: AppiumRecordedStep[];
  rootIds: string[];
};

type PasteTarget = {
  afterIndex: number;
  branch?: FlowBranch;
};

const targetKeys = [
  'yesTargetId',
  'noTargetId',
  'successTargetId',
  'failureTargetId',
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopeKey(step: AppiumRecordedStep) {
  return step.flow?.parentConditionId
    ? `${step.flow.parentConditionId}:${step.flow.parentBranch || ''}`
    : 'main';
}

function collectDescendantIds(steps: AppiumRecordedStep[], rootIds: Iterable<string>) {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (step.flow?.parentConditionId && ids.has(step.flow.parentConditionId) && !ids.has(step.id)) {
        ids.add(step.id);
        changed = true;
      }
    }
  }
  return ids;
}

function setFlowTarget(step: AppiumRecordedStep, key: typeof targetKeys[number], targetId: string) {
  const flow = { ...(step.flow || {}) };
  if (targetId) flow[key] = targetId;
  else delete flow[key];
  step.flow = Object.keys(flow).length ? flow : undefined;
}

function wireContinuation(step: AppiumRecordedStep, targetId: string) {
  setFlowTarget(step, 'successTargetId', targetId);
  if (step.flow?.nodeKind !== 'condition' || !targetId) return;
  if (!step.flow.yesTargetId) setFlowTarget(step, 'yesTargetId', targetId);
  if (!step.flow.noTargetId) setFlowTarget(step, 'noTargetId', targetId);
}

export function createFlowClipboard(steps: AppiumRecordedStep[], indexes: number[]): FlowClipboard {
  const selectedIndexes = [...new Set(indexes)].sort((left, right) => left - right);
  const selectedSteps = selectedIndexes.map((index) => steps[index]).filter(Boolean);
  const selectedIds = new Set(selectedSteps.map((step) => step.id));
  const roots = selectedSteps.filter((step) => {
    let parentId = step.flow?.parentConditionId;
    while (parentId) {
      if (selectedIds.has(parentId)) return false;
      parentId = steps.find((item) => item.id === parentId)?.flow?.parentConditionId;
    }
    return true;
  });
  if (!roots.length) throw new Error('请选择要复制的节点');
  const isDisconnected = roots.some((step, index) => {
    if (!index) return false;
    const previous = roots[index - 1];
    if (scopeKey(previous) !== scopeKey(step)) {
      return previous.flow?.successTargetId !== step.id;
    }
    const siblings = steps.filter((item) => scopeKey(item) === scopeKey(step));
    return siblings.findIndex((item) => item.id === step.id)
      !== siblings.findIndex((item) => item.id === previous.id) + 1;
  });
  if (isDisconnected) {
    throw new Error('批量复制只能选择连续节点');
  }

  const rootIds = roots.map((step) => step.id);
  const copiedIds = collectDescendantIds(steps, rootIds);
  const copiedSteps = steps.filter((step) => copiedIds.has(step.id));
  if (copiedSteps.some((step) => step.type === 'launchApp')) {
    throw new Error('启动 APP 节点不能复制');
  }
  return { steps: clone(copiedSteps), rootIds };
}

export function pasteFlowClipboard(
  steps: AppiumRecordedStep[],
  clipboard: FlowClipboard,
  target: PasteTarget,
  createId: () => string = () => `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
) {
  if (!clipboard.steps.length || !clipboard.rootIds.length) throw new Error('复制板中没有节点');

  const idMap = new Map(clipboard.steps.map((step) => [step.id, createId()]));
  const rootIdSet = new Set(clipboard.rootIds);
  const condition = target.branch ? steps[target.afterIndex] : undefined;
  if (target.branch && (!condition || condition.flow?.nodeKind !== 'condition')) {
    throw new Error('目标分支不存在');
  }

  const copies = clipboard.steps.map((source) => {
    const step = clone(source);
    step.id = idMap.get(source.id) || createId();
    const flow = { ...(step.flow || {}) };
    for (const key of targetKeys) {
      const mappedId = flow[key] ? idMap.get(flow[key] || '') : '';
      if (mappedId) flow[key] = mappedId;
      else delete flow[key];
    }
    if (flow.parentConditionId) {
      const mappedParentId = idMap.get(flow.parentConditionId);
      if (mappedParentId) flow.parentConditionId = mappedParentId;
      else {
        delete flow.parentConditionId;
        delete flow.parentBranch;
      }
    }
    if (rootIdSet.has(source.id)) {
      if (target.branch && condition) {
        flow.parentConditionId = condition.id;
        flow.parentBranch = target.branch;
      } else {
        delete flow.parentConditionId;
        delete flow.parentBranch;
      }
    }
    step.flow = Object.keys(flow).length ? flow : undefined;
    return step;
  });

  const copiedBySourceId = new Map(clipboard.steps.map((step, index) => [step.id, copies[index]]));
  const copiedRoots = clipboard.rootIds
    .map((id) => copiedBySourceId.get(id))
    .filter((step): step is AppiumRecordedStep => Boolean(step));
  const firstRoot = copiedRoots[0];
  const lastRoot = copiedRoots[copiedRoots.length - 1];
  if (!firstRoot || !lastRoot) throw new Error('复制节点数据无效');

  const nextSteps = [...steps];
  let insertAfterIndex = target.afterIndex;
  let continuationId = '';

  if (target.branch && condition) {
    const branchRoots = steps.filter((step) => (
      step.flow?.parentConditionId === condition.id
      && step.flow.parentBranch === target.branch
    ));
    if (branchRoots.length) {
      const ownedIds = collectDescendantIds(steps, branchRoots.map((step) => step.id));
      insertAfterIndex = Math.max(...steps.flatMap((step, index) => (ownedIds.has(step.id) ? [index] : [])));
      const lastExistingRoot = branchRoots[branchRoots.length - 1];
      continuationId = lastExistingRoot.flow?.successTargetId || condition.flow?.successTargetId || '';
      const lastExistingIndex = nextSteps.findIndex((step) => step.id === lastExistingRoot.id);
      const updatedLastExisting = clone(nextSteps[lastExistingIndex]);
      setFlowTarget(updatedLastExisting, 'successTargetId', firstRoot.id);
      nextSteps[lastExistingIndex] = updatedLastExisting;
    } else {
      const targetKey = target.branch === 'yes' ? 'yesTargetId' : 'noTargetId';
      const currentTargetId = condition.flow?.[targetKey] || '';
      const currentTarget = steps.find((step) => step.id === currentTargetId);
      continuationId = currentTarget && !currentTarget.flow?.parentConditionId
        ? currentTargetId
        : condition.flow?.successTargetId || '';
      const updatedCondition = clone(nextSteps[target.afterIndex]);
      setFlowTarget(updatedCondition, targetKey, firstRoot.id);
      nextSteps[target.afterIndex] = updatedCondition;
    }
  } else {
    const previous = target.afterIndex >= 0 ? nextSteps[target.afterIndex] : undefined;
    const nextMainStep = steps.slice(target.afterIndex + 1).find((step) => !step.flow?.parentConditionId);
    continuationId = previous?.flow?.successTargetId || nextMainStep?.id || '';
    if (previous?.flow?.successTargetId) {
      const updatedPrevious = clone(previous);
      setFlowTarget(updatedPrevious, 'successTargetId', firstRoot.id);
      nextSteps[target.afterIndex] = updatedPrevious;
    }
  }

  wireContinuation(lastRoot, continuationId);
  nextSteps.splice(insertAfterIndex + 1, 0, ...copies);
  return nextSteps;
}
