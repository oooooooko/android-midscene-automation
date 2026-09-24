import type { AppiumRecordedStep } from './types';

export const MAX_LOOP_ITERATIONS = 10000;
export const defaultLoopConfig = () => ({ maxIterations: 3, exitWhen: 'never' as const });

export function validateLoop(step: AppiumRecordedStep) {
  const config = step.loop;
  if (!config || !Number.isInteger(config.maxIterations) || config.maxIterations < 1 || config.maxIterations > MAX_LOOP_ITERATIONS) {
    throw new Error(`循环最大次数必须是 1-${MAX_LOOP_ITERATIONS} 的整数`);
  }
  if (!['never', 'exists', 'notExists'].includes(config.exitWhen)) throw new Error('循环退出条件无效');
  if (config.exitWhen !== 'never' && (!step.selector?.value?.trim() || !['id', 'accessibilityId', 'xpath', 'androidUiAutomator'].includes(step.selector.strategy))) {
    throw new Error('请设置循环退出条件的元素定位内容');
  }
  return config;
}

// Branch ownership, not array adjacency, determines the innermost active loop.
export function enclosingLoop(steps: readonly AppiumRecordedStep[], step: AppiumRecordedStep): AppiumRecordedStep | undefined {
  return enclosingLoops(steps, step)[0];
}

export function enclosingLoops(steps: readonly AppiumRecordedStep[], step: AppiumRecordedStep): AppiumRecordedStep[] {
  const loops: AppiumRecordedStep[] = [];
  const byId = new Map(steps.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let current = step;
  while (current.flow?.parentConditionId) {
    const parent = byId.get(current.flow.parentConditionId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    if (parent.type === 'loop' && current.flow.parentBranch === 'yes') loops.push(parent);
    current = parent;
  }
  return loops;
}

export function breakLoopTarget(steps: readonly AppiumRecordedStep[], step: AppiumRecordedStep) {
  const loops = enclosingLoops(steps, step);
  const target = step.breakLoopTargetId ? loops.find((loop) => loop.id === step.breakLoopTargetId) : loops[0];
  if (!target) throw new Error('退出循环目标必须是当前节点所属的循环体，目标可能已删除或不在当前分支');
  return target;
}

export function continueLoopTarget(steps: readonly AppiumRecordedStep[], step: AppiumRecordedStep) {
  const loops = enclosingLoops(steps, step);
  const target = step.continueLoopTargetId ? loops.find((loop) => loop.id === step.continueLoopTargetId) : loops[0];
  if (!target) throw new Error('继续循环目标必须是当前节点所属的循环体，目标可能已删除或不在当前分支');
  return target;
}

export function validateLoopSteps(steps: readonly AppiumRecordedStep[]) {
  if (!steps.some((step) => ['loop', 'breakLoop', 'continueLoop'].includes(step.type))) return;
  const byId = new Map(steps.map((step) => [step.id, step]));
  if (byId.size !== steps.length) throw new Error('流程节点 ID 重复');
  for (const step of steps) {
    let current: AppiumRecordedStep | undefined = step;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.id)) throw new Error('流程分支归属存在循环');
      seen.add(current.id);
      const id: string | undefined = current.flow?.parentConditionId;
      if (id && !byId.has(id)) throw new Error('流程分支所属节点不存在');
      current = id ? byId.get(id) : undefined;
    }
    if (step.type === 'loop') validateLoop(step);
    if (step.type === 'breakLoop') breakLoopTarget(steps, step);
    if (step.type === 'continueLoop') continueLoopTarget(steps, step);
    if (step.type === 'loop' && step.flow?.yesTargetId) {
      const target = byId.get(step.flow.yesTargetId);
      if (!target || target.flow?.parentConditionId !== step.id || target.flow.parentBranch !== 'yes') throw new Error('循环入口必须指向所属循环体');
    }
  }
}
