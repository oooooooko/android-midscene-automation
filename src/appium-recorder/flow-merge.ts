import type { AppiumRecordedStep } from './types';
import { defaultFlowKind } from './flow-labels';

type Branch = 'yes' | 'no';
export function branchSteps(steps: AppiumRecordedStep[], conditionId: string, branch: Branch) {
  return steps.filter((step) => step.flow?.parentConditionId === conditionId && step.flow.parentBranch === branch);
}

function descendants(steps: AppiumRecordedStep[], roots: string[]) {
  const ids = new Set(roots);
  for (let changed = true; changed;) {
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

// 合流仅提升明确选中的分支后缀，不按名称猜测重复节点，也不改写其他判断的分支。
export function mergeBranches(steps: AppiumRecordedStep[], conditionId: string, commonId: string, duplicateId = '') {
  const condition = steps.find((step) => step.id === conditionId);
  const common = steps.find((step) => step.id === commonId);
  if (!condition || defaultFlowKind(condition) !== 'condition') throw new Error('请选择判断节点');
  if (condition.type === 'loop') throw new Error('循环体与循环结束路径不能合并');
  if (condition.flow?.successTargetId) throw new Error('该判断已有后续公共流程，不能重复合流');
  if (!common || common.flow?.parentConditionId !== conditionId || !common.flow.parentBranch) throw new Error('公共起点必须属于当前判断的直接分支');
  const side = common.flow.parentBranch;
  const otherSide = side === 'yes' ? 'no' : 'yes';
  const source = branchSteps(steps, conditionId, side);
  const other = branchSteps(steps, conditionId, otherSide);
  const commonRoots = source.slice(source.findIndex((step) => step.id === commonId));
  const commonIds = descendants(steps, commonRoots.map((step) => step.id));
  const duplicateIndex = other.findIndex((step) => step.id === duplicateId);
  if (duplicateId && duplicateIndex < 0) throw new Error('重复部分必须属于另一侧直接分支');
  const removedIds = descendants(steps, duplicateId ? other.slice(duplicateIndex).map((step) => step.id) : []);
  const ownedIds = descendants(steps, [conditionId]);
  const keys = ['yesTargetId', 'noTargetId', 'successTargetId', 'failureTargetId'] as const;
  for (const step of steps) {
    for (const key of keys) {
      const target = step.flow?.[key];
      if (!target) continue;
      if (commonIds.has(step.id) && ownedIds.has(target) && !commonIds.has(target)) throw new Error('公共流程存在返回分支的连接，合流会形成循环');
      if (!ownedIds.has(step.id) && removedIds.has(target)) throw new Error('待删除节点被其他流程引用，不能合并');
      if (ownedIds.has(step.id) && !commonIds.has(step.id) && !removedIds.has(step.id) && !ownedIds.has(target)) throw new Error('分支已有外部连接，请先处理该连接');
    }
  }
  const next = steps.filter((step) => !removedIds.has(step.id)).map((step) => ({ ...step, flow: { ...step.flow } }));
  const byId = new Map(next.map((step) => [step.id, step]));
  const mergedCondition = byId.get(conditionId)!;
  mergedCondition.flow.successTargetId = commonId;
  // 只改变公共后缀的直接归属；后缀内部的嵌套判断仍拥有自己的子节点。
  for (const root of commonRoots) {
    const flow = byId.get(root.id)!.flow;
    delete flow.parentConditionId;
    delete flow.parentBranch;
    if (condition.flow?.parentConditionId) {
      flow.parentConditionId = condition.flow.parentConditionId;
      flow.parentBranch = condition.flow.parentBranch;
    }
  }
  function connectEnd(step: typeof next[number]) {
    if (step.type === 'endFlow' || step.type === 'breakLoop') return;
    step.flow.successTargetId = commonId;
    if (defaultFlowKind(step) === 'condition') {
      for (const branch of (step.type === 'loop' ? ['no'] : ['yes', 'no']) as Branch[]) {
        const children = branchSteps(next, step.id, branch);
        if (children.length) connectEnd(byId.get(children[children.length - 1]!.id)!);
        else step.flow[branch === 'yes' ? 'yesTargetId' : 'noTargetId'] = commonId;
      }
    }
  }
  for (const branch of ['yes', 'no'] as const) {
    const remaining = branchSteps(next, conditionId, branch);
    mergedCondition.flow[branch === 'yes' ? 'yesTargetId' : 'noTargetId'] = remaining[0]?.id || commonId;
    if (remaining.length) connectEnd(byId.get(remaining[remaining.length - 1]!.id)!);
  }
  // 公共节点排在整个分支子树之后，保存和顺序回放不会插入到另一侧分支中。
  const commonBlock = next.filter((step) => commonIds.has(step.id));
  const rest = next.filter((step) => !commonIds.has(step.id));
  let after = rest.findIndex((step) => step.id === conditionId);
  rest.forEach((step, index) => { if (ownedIds.has(step.id)) after = Math.max(after, index); });
  rest.splice(after + 1, 0, ...commonBlock);
  for (const step of rest) {
    for (const key of keys) {
      if (step.flow[key] && removedIds.has(step.flow[key]!)) step.flow[key] = commonId;
    }
  }
  // 校验完整执行图，包含隐式顺序边，拒绝回边及跨分支错误连接。
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(step: typeof next[number]) {
    if (visiting.has(step.id)) throw new Error('合流会形成循环，请检查节点连接');
    if (visited.has(step.id)) return;
    visiting.add(step.id);
    const index = rest.indexOf(step);
    const targets = keys.map((key) => step.flow[key]).filter(Boolean) as string[];
    if (defaultFlowKind(step) !== 'condition' && step.type !== 'endFlow' && !step.flow.successTargetId) {
      const sibling = rest.slice(index + 1).find((item) => item.flow.parentConditionId === step.flow.parentConditionId && item.flow.parentBranch === step.flow.parentBranch);
      if (sibling) targets.push(sibling.id);
    }
    for (const id of targets) { const target = byId.get(id); if (target) visit(target); }
    visiting.delete(step.id);
    visited.add(step.id);
  }
  rest.forEach(visit);
  // 仅记录结构差异和实际被删除的节点，配置编辑不会被取消合并覆盖。
  const lastCommon = Math.max(...commonRoots.map(step => steps.indexOf(step)));
  mergedCondition.mergeUndo = JSON.parse(JSON.stringify({
    version: 1, conditionId, source: side, commonIds: [...commonIds], originalIds: steps.map(step => step.id),
    boundaryId: steps.slice(lastCommon + 1).find(step => !ownedIds.has(step.id)
      && step.flow?.parentConditionId === condition.flow?.parentConditionId
      && step.flow?.parentBranch === condition.flow?.parentBranch)?.id,
    flows: steps.filter(step => !removedIds.has(step.id) && (ownedIds.has(step.id)
      || keys.some(key => step.flow?.[key] !== byId.get(step.id)?.flow[key])))
      .map(step => ({ id: step.id, before: step.flow, after: byId.get(step.id)?.flow })),
    removed: steps.filter(step => removedIds.has(step.id)),
  }));
  return { steps: rest, removedCount: removedIds.size };
}
