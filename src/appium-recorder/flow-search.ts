import type { AppiumRecordedStep } from './types';
import { flowBranchLabel, labelFlowStep } from './flow-labels';

export type FlowSearchResult = { id: string; index: number; title: string; meta: string; branch: string };

export function searchFlowNodes(steps: AppiumRecordedStep[], query: string): FlowSearchResult[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const byId = new Map(steps.map((step) => [step.id, step]));
  return steps.flatMap((step, index) => {
    const label = labelFlowStep(step);
    const content = [label.title, label.meta, label.note, step.type, step.selector?.value, step.contextSelector?.value,
      step.value, step.logPrefix].filter(Boolean).join(' ').toLocaleLowerCase();
    if (!terms.every((term) => content.includes(term))) return [];
    const path: string[] = [];
    const visited = new Set([step.id]);
    let current = step;
    // Follow ownership rather than outgoing edges so merged flows never inherit a sibling branch.
    while (current.flow?.parentConditionId) {
      const parent = byId.get(current.flow.parentConditionId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      const branch = current.flow.parentBranch;
      path.unshift(`${parent.label} · ${branch ? flowBranchLabel(parent, branch) : '分支'}`);
      current = parent;
    }
    return [{ id: step.id, index, title: label.title, meta: label.meta, branch: ['主流程', ...path].join(' / ') }];
  });
}
