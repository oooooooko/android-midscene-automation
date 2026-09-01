import type { AppiumRecordedStep } from './types';

export type VisualChangeBranchTarget = {
  stepId: string;
  branch: 'yes' | 'no';
};

const FLOW_TARGET_KEYS = ['successTargetId', 'failureTargetId'] as const;

export function visualChangePairNumber(label?: string) {
  const match = /^检测画面变化(\d+)$/.exec(label || '');
  return match ? Number(match[1]) : 0;
}

export function nextVisualChangePairLabel(steps: AppiumRecordedStep[]) {
  const maxNumber = steps.reduce((max, step) => Math.max(
    max,
    visualChangePairNumber(step.visualChange?.pairLabel),
  ), 0);
  return `检测画面变化${maxNumber + 1}`;
}

function rawBranchPathForStep(steps: AppiumRecordedStep[], step?: AppiumRecordedStep) {
  const path: string[] = [];
  let current = step;
  let guard = 0;
  while (current?.flow?.parentConditionId && current.flow.parentBranch && guard < steps.length) {
    path.unshift(`${current.flow.parentConditionId}:${current.flow.parentBranch}`);
    current = steps.find((item) => item.id === current?.flow?.parentConditionId);
    guard += 1;
  }
  return path;
}

function uniqueBranchPaths(paths: string[][]) {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = path.join('|');
    if (!path.length || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function branchTargetPath(
  steps: AppiumRecordedStep[],
  condition: AppiumRecordedStep,
  branch: 'yes' | 'no',
  seen: Set<string>,
) {
  return [...branchPathForStep(steps, condition, new Set(seen)), `${condition.id}:${branch}`];
}

export function branchPathForStep(
  steps: AppiumRecordedStep[],
  step?: AppiumRecordedStep,
  seen = new Set<string>(),
) {
  const rawPath = rawBranchPathForStep(steps, step);
  if (rawPath.length || !step || seen.has(step.id)) return rawPath;
  seen.add(step.id);

  const incomingPaths = uniqueBranchPaths(steps.flatMap((source) => {
    if (!source.flow || source.id === step.id) return [];
    const paths: string[][] = [];
    if (source.flow.nodeKind === 'condition') {
      if (source.flow.yesTargetId === step.id) paths.push(branchTargetPath(steps, source, 'yes', seen));
      if (source.flow.noTargetId === step.id) paths.push(branchTargetPath(steps, source, 'no', seen));
    }
    FLOW_TARGET_KEYS.forEach((key) => {
      if (source.flow?.[key] === step.id) paths.push(branchPathForStep(steps, source, new Set(seen)));
    });
    return paths;
  }));

  return incomingPaths.length === 1 ? incomingPaths[0] : [];
}

// Branch paths are stored as an ancestry chain like
// ["outer:yes", "inner:no"]. A root node before a condition has an empty
// path, so it can be closed by an end marker in either downstream branch.
export function branchPathForInsert(
  steps: AppiumRecordedStep[],
  index?: number,
  branchTarget?: VisualChangeBranchTarget,
) {
  if (branchTarget) {
    const condition = steps.find((step) => step.id === branchTarget.stepId);
    return [...branchPathForStep(steps, condition), `${branchTarget.stepId}:${branchTarget.branch}`];
  }
  return typeof index === 'number' && index >= 0
    ? branchPathForStep(steps, steps[index])
    : [];
}

function sameBranchPath(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function branchPathContains(parent: string[], child: string[]) {
  return parent.length <= child.length && parent.every((value, index) => value === child[index]);
}

function visualChangeRole(step: AppiumRecordedStep) {
  return step.visualChange?.role;
}

function isEndForStart(endStep: AppiumRecordedStep, startStep: AppiumRecordedStep) {
  const start = startStep.visualChange;
  const end = endStep.visualChange;
  if (!start || end?.role !== 'end') return false;
  if (start.pairId && end.pairId === start.pairId) return true;
  if (end.startStepId && end.startStepId === startStep.id) return true;
  return Boolean(
    start.pairLabel
      && end.pairLabel === start.pairLabel
      && (!start.pairId || !end.pairId || !end.startStepId),
  );
}

export function findOpenVisualChangeStart(
  steps: AppiumRecordedStep[],
  index?: number,
  branchTarget?: VisualChangeBranchTarget,
) {
  const insertPath = branchPathForInsert(steps, index, branchTarget);
  const insertIndex = typeof index === 'number' ? index : steps.length - 1;
  // A start marker may be closed once per concrete branch path. This allows a
  // root start before a condition to have independent yes/no end markers, while
  // preventing a yes-branch start from pairing with a no-branch end.
  const hasEndInInsertBranch = (startStep: AppiumRecordedStep) => steps.some((step) => (
    isEndForStart(step, startStep)
    && sameBranchPath(branchPathForStep(steps, step), insertPath)
  ));

  return steps
    .map((step, stepIndex) => ({ step, stepIndex, path: branchPathForStep(steps, step) }))
    .filter(({ step, stepIndex, path }) => (
      visualChangeRole(step) === 'start'
      && stepIndex <= insertIndex
      && branchPathContains(path, insertPath)
      && !hasEndInInsertBranch(step)
    ))
    .sort((left, right) => (
      right.path.length - left.path.length || right.stepIndex - left.stepIndex
    ))[0]?.step;
}
