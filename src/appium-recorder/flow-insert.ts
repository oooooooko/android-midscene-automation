import type { AppiumRecordedStep } from './types';

/** 在公共节点前插入，不改变原有分支归属，并重接所有显式汇入连接。 */
export function insertBeforeSharedStep(steps: AppiumRecordedStep[], targetId: string, additions: AppiumRecordedStep[], rootIds: string[]) {
  const index = steps.findIndex(step => step.id === targetId);
  if (index < 0) throw new Error('合流节点已不存在，请重新选择插入位置');
  const target = steps[index];
  const roots = new Set(rootIds);
  const first = rootIds[0];
  const last = rootIds[rootIds.length - 1];
  if (!first || !last) throw new Error('没有可插入的节点');
  const inserted = additions.map(step => roots.has(step.id) ? {
    ...step, flow: { ...step.flow, parentConditionId: target.flow?.parentConditionId, parentBranch: target.flow?.parentBranch,
      ...(step.id === last ? { successTargetId: targetId } : {}) },
  } : step);
  const result = steps.map(step => {
    if (!step.flow) return step;
    const flow = { ...step.flow };
    for (const key of ['yesTargetId', 'noTargetId', 'successTargetId'] as const) {
      if (flow[key] === targetId) flow[key] = first;
    }
    return { ...step, flow };
  });
  // 无显式目标的默认返回会按同作用域顺序落到新节点。
  result.splice(index, 0, ...inserted);
  return result;
}
