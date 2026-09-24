import type { AppiumRecordedStep } from './types';
import { branchSteps } from './flow-merge';
import { defaultFlowKind } from './flow-labels';
import { createStepId } from './visual-change';

const edges = ['yesTargetId', 'noTargetId', 'successTargetId', 'failureTargetId'] as const;
const structure = [...edges, 'parentConditionId', 'parentBranch'] as const;
export type AddedNodeSide = 'yes' | 'no' | 'both';

export function unmergeBranches(steps: AppiumRecordedStep[], conditionId: string, addedSide?: AddedNodeSide) {
  const condition = steps.find(step => step.id === conditionId);
  const record = condition?.mergeUndo;
  if (!record || record.version !== 1 || record.conditionId !== conditionId) {
    throw new Error('该合并没有可用的还原记录，无法安全取消；仅新执行的合并支持还原');
  }
  const original = new Set(record.originalIds);
  const common = new Set(record.commonIds);
  const affected = new Set(record.flows.map(item => item.id));
  const byId = new Map(steps.map(step => [step.id, step]));
  if (record.flows.some(item => !byId.has(item.id)) || record.removed.some(step => byId.has(step.id))) {
    throw new Error('合并涉及的节点已删除或 ID 冲突，无法安全取消');
  }
  const boundary = record.boundaryId ? steps.findIndex(step => step.id === record.boundaryId) : steps.length;
  if (boundary < 0) throw new Error('公共流程边界已删除，无法安全取消');
  const added = steps.slice(steps.indexOf(condition!) + 1, boundary).filter(step => !original.has(step.id)
    && step.flow?.parentConditionId === condition!.flow?.parentConditionId
    && step.flow?.parentBranch === condition!.flow?.parentBranch);
  const shared = new Set([...common, ...added.map(step => step.id)]);
  // 普通新增操作可分配到任一侧；控制节点和跨节点配对不做猜测性复制。
  if (added.some(step => defaultFlowKind(step) === 'condition'
    || ['visualChange', 'breakLoop', 'continueLoop', 'endFlow'].includes(step.type) || step.mergeUndo)) {
    throw new Error('公共流程新增了判断、循环、终止或配对节点，请先移出这些节点再取消合并');
  }
  if (added.some(step => edges.some(key => step.flow?.[key]
    && !shared.has(step.flow[key]!) && step.flow[key] !== record.boundaryId))) {
    throw new Error('公共流程新增操作存在外部连接，请先处理该连接再取消合并');
  }
  for (const item of record.flows) {
    const current = byId.get(item.id)!;
    for (const key of structure) {
      if (current.flow?.[key] === item.after?.[key]) continue;
      const target = edges.includes(key as typeof edges[number]) ? byId.get(current.flow?.[key] || '') : undefined;
      if (!target || original.has(target.id) || defaultFlowKind(target) === 'condition') {
        throw new Error('合并后的连接或分支归属已改变，请先处理结构冲突再取消合并');
      }
    }
  }
  for (const step of steps) {
    if (!affected.has(step.id) && original.has(step.id) && edges.some(key => shared.has(step.flow?.[key] || ''))) {
      throw new Error('其他流程引用了公共节点，无法安全取消合并');
    }
  }
  const side = addedSide || record.source;
  const next: AppiumRecordedStep[] = JSON.parse(JSON.stringify(steps));
  const nextById = new Map(next.map(step => [step.id, step]));
  // 只撤回合并写入的结构字段，保留用户修改的名称、参数、备注等。
  for (const item of record.flows) {
    const step = nextById.get(item.id)!;
    const flow = step.flow ||= {};
    for (const key of structure) {
      if (item.before?.[key] === item.after?.[key]) continue;
      const current = flow[key];
      if (current !== item.after?.[key] && !shared.has(current || '')) continue;
      if (item.before?.[key] === undefined) delete flow[key];
      else Object.assign(flow, { [key]: item.before[key] });
    }
  }
  // 恢复被合并删除的另一侧节点，按原始邻接顺序插回，而非覆盖现有节点。
  for (const backup of record.removed) {
    const restored: AppiumRecordedStep = JSON.parse(JSON.stringify(backup));
    const later = record.originalIds.slice(record.originalIds.indexOf(backup.id) + 1);
    const anchor = later.map(id => next.findIndex(step => step.id === id)).find(index => index >= 0);
    next.splice(anchor ?? next.length, 0, restored);
    nextById.set(restored.id, restored);
  }
  const assigned = side === 'both' ? record.source : side;
  for (const item of added) {
    const step = nextById.get(item.id)!;
    step.flow = { ...step.flow, parentConditionId: conditionId, parentBranch: assigned };
    for (const key of edges) delete step.flow[key];
  }
  if (assigned !== record.source) {
    for (const item of added) {
      const index = next.findIndex(step => step.id === item.id);
      next.push(...next.splice(index, 1));
    }
  }
  if (side === 'both') {
    for (const item of added) {
      const copy: AppiumRecordedStep = JSON.parse(JSON.stringify(nextById.get(item.id)));
      copy.id = createStepId();
      copy.flow!.parentBranch = record.source === 'yes' ? 'no' : 'yes';
      next.push(copy);
    }
  }
  const other = record.source === 'yes' ? 'no' : 'yes';
  if (added.length && (side === 'both' || side === other)) {
    const siblings = branchSteps(next, conditionId, other);
    const appended = siblings.slice(-added.length);
    const previous = siblings[siblings.length - appended.length - 1];
    if (previous && (defaultFlowKind(previous) === 'condition' || ['endFlow', 'breakLoop', 'continueLoop'].includes(previous.type))) {
      throw new Error('另一侧末尾是判断、循环或终止操作，新增节点不能安全追加，请仅保留在原来源分支');
    }
    if (previous?.flow?.successTargetId) {
      appended[appended.length - 1]!.flow!.successTargetId = previous.flow.successTargetId;
      previous.flow.successTargetId = appended[0]!.id;
    }
  }
  const restoredCondition = nextById.get(conditionId)!;
  delete restoredCondition.mergeUndo;
  const ownerBranch = (step: AppiumRecordedStep): 'yes' | 'no' | undefined => {
    const visited = new Set<string>();
    let current: AppiumRecordedStep | undefined = step;
    while (current?.flow?.parentConditionId && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.flow.parentConditionId === conditionId) return current.flow.parentBranch;
      current = nextById.get(current.flow.parentConditionId);
    }
  };
  // 新增的分支尾节点可能仍指向公共入口，改接自己一侧的后续节点。
  for (const step of next) {
    const branch = ownerBranch(step);
    if (!branch) continue;
    const siblings = next.filter(item => item.flow?.parentConditionId === step.flow?.parentConditionId && item.flow?.parentBranch === step.flow?.parentBranch);
    const sibling = siblings[siblings.indexOf(step) + 1];
    for (const key of edges) {
      const target = nextById.get(step.flow?.[key] || '');
      if (!target || !shared.has(target.id)) continue;
      if (ownerBranch(target) === branch && !added.some(item => item.id === target.id)) continue;
      if (sibling) step.flow![key] = sibling.id;
      else delete step.flow![key];
    }
  }
  for (const branch of ['yes', 'no'] as const) {
    const first = branchSteps(next, conditionId, branch)[0];
    const key = branch === 'yes' ? 'yesTargetId' : 'noTargetId';
    if (first) restoredCondition.flow![key] = first.id;
    else delete restoredCondition.flow![key];
  }
  // 将两个分支的完整子树重新放到判断之后，公共后继保持原位。
  const owned = next.filter(step => ownerBranch(step));
  const result = next.filter(step => !owned.includes(step));
  result.splice(result.indexOf(restoredCondition) + 1, 0, ...owned);
  return { steps: result, addedCount: added.length };
}
