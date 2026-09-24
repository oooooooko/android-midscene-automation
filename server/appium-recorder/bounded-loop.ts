import type { AppiumRecordedStep } from '../../src/appium-recorder/types';
import { enclosingLoop, enclosingLoops, breakLoopTarget, continueLoopTarget, validateLoopSteps } from '../../src/appium-recorder/bounded-loop';
import { defaultFlowKind } from '../../src/appium-recorder/flow-labels';

/** Virtual returns keep the saved flow graph acyclic and preserve branch layout. */
export class BoundedLoopTraversal {
  private readonly byId: Map<string, number>;
  private readonly active = new Map<string, { iteration: number; visited: Set<string> }>();
  private readonly rootVisited = new Set<string>();
  private readonly owners = new Map<string, AppiumRecordedStep | undefined>();

  constructor(private readonly steps: AppiumRecordedStep[]) {
    validateLoopSteps(steps);
    this.byId = new Map(steps.map((step, index) => [step.id, index]));
  }

  private target(id?: string) { return id ? this.byId.get(id) : undefined; }
  private owner(step: AppiumRecordedStep) {
    if (!this.owners.has(step.id)) this.owners.set(step.id, enclosingLoop(this.steps, step));
    return this.owners.get(step.id);
  }

  visit(step: AppiumRecordedStep) {
    if (step.type === 'loop' && this.active.has(step.id)) return;
    const owner = this.owner(step);
    const frame = owner ? this.active.get(owner.id) : undefined;
    if (owner && !frame) throw new Error('不能从循环外直接进入循环体');
    const visited = frame?.visited || this.rootVisited;
    if (visited.has(step.id)) throw new Error('流程存在非有界循环回边，已终止回放');
    visited.add(step.id);
  }

  private continuation(step: AppiumRecordedStep, seen = new Set<string>()): number | undefined {
    if (seen.has(step.id)) throw new Error('流程分支归属存在循环');
    seen.add(step.id);
    if (step.flow?.successTargetId) return this.target(step.flow.successTargetId);
    if (defaultFlowKind(step) === 'condition') {
      const start = this.byId.get(step.id)!;
      const sibling = this.steps.findIndex((item, index) => index > start && item.flow?.parentConditionId === step.flow?.parentConditionId && item.flow?.parentBranch === step.flow?.parentBranch);
      if (sibling >= 0) return sibling;
    }
    const parentIndex = this.target(step.flow?.parentConditionId);
    if (parentIndex === undefined) return;
    const parent = this.steps[parentIndex]!;
    if (parent.type === 'loop' && step.flow?.parentBranch === 'yes') return parentIndex;
    return this.continuation(parent, seen);
  }

  private returnAtBoundary(step: AppiumRecordedStep, next: number | undefined) {
    const owner = this.owner(step);
    if (!owner || !this.active.has(owner.id)) return next;
    // The end of any nested branch returns to the loop, not to the other branch.
    if (next === undefined || (this.steps[next]?.id !== owner.id && !this.isInBody(this.steps[next]!, owner.id))) {
      return this.target(owner.id);
    }
    return next;
  }

  private isInBody(step: AppiumRecordedStep, loopId: string) {
    let owner = this.owner(step);
    const seen = new Set<string>();
    while (owner && !seen.has(owner.id)) {
      if (owner.id === loopId) return true;
      seen.add(owner.id); owner = this.owner(owner);
    }
    return false;
  }

  next(step: AppiumRecordedStep, index: number) {
    let next = this.target(step.flow?.successTargetId);
    if (!step.flow?.successTargetId) {
      const sibling = this.steps[index + 1];
      next = sibling && sibling.flow?.parentConditionId === step.flow?.parentConditionId && sibling.flow?.parentBranch === step.flow?.parentBranch
        ? index + 1 : this.continuation(step);
    }
    return this.returnAtBoundary(step, next);
  }

  branch(step: AppiumRecordedStep, matched: boolean) {
    const id = matched ? step.flow?.yesTargetId : step.flow?.noTargetId;
    return this.returnAtBoundary(step, id ? this.target(id) : this.continuation(step));
  }

  iteration(step: AppiumRecordedStep) { return this.active.get(step.id)?.iteration || 0; }

  enter(step: AppiumRecordedStep) {
    const iteration = this.iteration(step) + 1;
    if (iteration > step.loop!.maxIterations) throw new Error('循环次数超过上限');
    this.active.set(step.id, { iteration, visited: new Set() });
    return { iteration, next: this.target(step.flow?.yesTargetId) ?? this.target(step.id) };
  }

  exit(step: AppiumRecordedStep) {
    this.active.delete(step.id);
    return this.returnAtBoundary(step, this.target(step.flow?.noTargetId) ?? this.continuation(step));
  }

  break(step: AppiumRecordedStep) {
    const owner = breakLoopTarget(this.steps, step);
    if (!this.active.has(owner.id)) throw new Error('目标循环当前未执行');
    // Unwind inner frames without running their completion branches.
    for (const inner of enclosingLoops(this.steps, step)) {
      if (inner.id === owner.id) break;
      this.active.delete(inner.id);
    }
    return { loop: owner, iteration: this.iteration(owner), next: this.exit(owner) };
  }

  continue(step: AppiumRecordedStep) {
    const owner = continueLoopTarget(this.steps, step);
    if (!this.active.has(owner.id)) throw new Error('目标循环当前未执行');
    // 跳到外层循环时，内层循环的当前轮同时结束，但目标循环仍保持活动状态。
    for (const inner of enclosingLoops(this.steps, step)) {
      if (inner.id === owner.id) break;
      this.active.delete(inner.id);
    }
    return { loop: owner, iteration: this.iteration(owner), next: this.target(owner.id) };
  }

  context(step: AppiumRecordedStep) {
    const parts: string[] = [];
    let owner = this.owner(step);
    while (owner) {
      parts.unshift(`${owner.label} 第 ${this.iteration(owner)}/${owner.loop!.maxIterations} 轮`);
      owner = this.owner(owner);
    }
    return parts.join(' / ');
  }
}
