import type { AppiumRecordedStep } from './types';

export const FLOW_NODE_WIDTH = 420;
export const FLOW_BRANCH_GAP = 16;

export type ConditionLayout = {
  yesWidth: number;
  noWidth: number;
  totalWidth: number;
  yesAxis: number;
  noAxis: number;
};

export type ConditionPlacement = {
  left: number;
  startAxis: number;
  yesAxis: number;
  noAxis: number;
};

export function placeConditionLayout(
  layout: ConditionLayout,
  canvasWidth: number,
  parentAxis: number,
): ConditionPlacement {
  const parentCenter = (parentAxis / 100) * canvasWidth;
  const left = Math.min(
    Math.max(parentCenter - layout.totalWidth / 2, 0),
    Math.max(canvasWidth - layout.totalWidth, 0),
  );
  const yesCenter = left + layout.yesWidth / 2;
  const noCenter = left + layout.yesWidth + FLOW_BRANCH_GAP + layout.noWidth / 2;
  return {
    left,
    startAxis: ((parentCenter - left) / layout.totalWidth) * 100,
    yesAxis: (yesCenter / canvasWidth) * 100,
    noAxis: (noCenter / canvasWidth) * 100,
  };
}

export function buildConditionLayouts(steps: AppiumRecordedStep[]) {
  const layouts = new Map<string, ConditionLayout>();
  const visiting = new Set<string>();

  function conditionLayout(conditionId: string): ConditionLayout {
    const cached = layouts.get(conditionId);
    if (cached) return cached;
    if (visiting.has(conditionId)) {
      return {
        yesWidth: FLOW_NODE_WIDTH,
        noWidth: FLOW_NODE_WIDTH,
        totalWidth: FLOW_NODE_WIDTH * 2 + FLOW_BRANCH_GAP,
        yesAxis: 25,
        noAxis: 75,
      };
    }

    visiting.add(conditionId);
    const branchWidth = (branch: 'yes' | 'no') => Math.max(
      FLOW_NODE_WIDTH,
      ...steps
        .filter((step) => (
          step.flow?.parentConditionId === conditionId
          && step.flow.parentBranch === branch
          && step.flow.nodeKind === 'condition'
        ))
        .map((step) => conditionLayout(step.id).totalWidth),
    );
    const yesWidth = branchWidth('yes');
    const noWidth = branchWidth('no');
    const totalWidth = yesWidth + FLOW_BRANCH_GAP + noWidth;
    const layout = {
      yesWidth,
      noWidth,
      totalWidth,
      yesAxis: (yesWidth / 2 / totalWidth) * 100,
      noAxis: ((yesWidth + FLOW_BRANCH_GAP + noWidth / 2) / totalWidth) * 100,
    };
    visiting.delete(conditionId);
    layouts.set(conditionId, layout);
    return layout;
  }

  steps
    .filter((step) => step.flow?.nodeKind === 'condition')
    .forEach((step) => conditionLayout(step.id));
  return layouts;
}
