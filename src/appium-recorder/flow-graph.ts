import { Position, type Edge, type Node } from '@vue-flow/core';
import * as dagre from '@dagrejs/dagre';
import type { AppiumRecordedStep } from './types';
import { defaultFlowKind as defaultKind, flowBranchLabel, isBooleanCondition } from './flow-labels';

type DagreApi = typeof dagre;
const dagreApi = ((dagre as DagreApi & { default?: DagreApi }).layout
  ? dagre
  : (dagre as DagreApi & { default?: DagreApi }).default || dagre) as DagreApi;

export type FlowKind = 'action' | 'condition' | 'assertion';
export type FlowBranch = 'yes' | 'no';
export type InsertAction =
  | 'delay'
  | 'tap'
  | 'input'
  | 'clearInput'
  | 'coordinateTap'
  | 'longPress'
  | 'keyBack'
  | 'keyHome'
  | 'keyRecent'
  | 'keyPower'
  | 'swipe'
  | 'pinch'
  | 'launchApp'
  | 'openGallery'
  | 'endFlow'
  | 'clearAppData'
  | 'popupCondition'
  | 'checkboxState'
  | 'checkedState'
  | 'radioButtonState'
  | 'aiRecognition'
  | 'textClick'
  | 'tapIfExists'
  | 'inputIfExists'
  | 'clearIfExists'
  | 'backIfExists'
  | 'waitFor'
  | 'assertExists'
  | 'assertText'
  | 'waitDisappear'
  | 'waitActivity'
  | 'runScript'
  | 'noop'
  | 'log'
  | 'visualChangeStart'
  | 'visualChangeEnd'
  | 'visualChange';

export const PASTE_COMMAND = '__paste_flow_nodes__';
export const FLOW_STEP_NODE_WIDTH = 340;
export const FLOW_STEP_NODE_HEIGHT = 78;
export const FLOW_EXPANDED_NODE_HEIGHT = 336;
export const FLOW_START_NODE_WIDTH = 180;
export const FLOW_START_NODE_HEIGHT = 62;
export const FLOW_INSERT_NODE_SIZE = 34;
export const FLOW_BRANCH_NODE_WIDTH = 34;
export const FLOW_BRANCH_NODE_HEIGHT = 26;
export const FLOW_SPLIT_NODE_SIZE = 10;
const FLOW_STANDARD_LINE_GAP = 24;
const FLOW_BRANCH_TRUNK_GAP = 96;
const FLOW_BRANCH_LABEL_GAP = 58;
const FLOW_BRANCH_MIN_SPREAD = 260;
const FLOW_BRANCH_SUBTREE_GAP = 80;

export type FlowActionGroup = {
  title: string;
  actions: Array<{ type: InsertAction; label: string }>;
};

export type FlowGraphNodeData =
  | {
      kind: 'start';
      actionGroups: FlowActionGroup[];
      clipboardCount?: number;
      canOpenInsertMenu: boolean;
      isActionDisabled: (action: InsertAction) => boolean;
    }
  | {
      kind: 'step';
      step: AppiumRecordedStep;
      index: number;
      flowKind: FlowKind;
      title: string;
      meta: string;
      note?: string;
      cardMinHeight: number;
      expanded: boolean;
      selected: boolean;
      copyMode: boolean;
      deleteMode?: boolean;
      disabled?: boolean;
      removeDisabled?: boolean;
      mergeDisabled?: boolean;
      launching?: boolean;
      canCopy: boolean;
      canEditInput: boolean;
      canExecute: boolean;
      missingAiModel?: boolean;
    }
  | {
      kind: 'insert';
      actionGroups: FlowActionGroup[];
      afterIndex: number;
      branch?: FlowBranch;
      branchLabel?: string;
      conditionIndex?: number;
      clipboardCount?: number;
      canOpenInsertMenu: boolean;
      isActionDisabled: (action: InsertAction) => boolean;
    }
  | {
      kind: 'branch';
      branch: FlowBranch;
      label: string;
      width: number;
      conditionIndex: number;
    }
  | {
      kind: 'split';
    };

export type FlowGraphNode = Node<FlowGraphNodeData>;
export type FlowGraphEdge = Edge<{ branch?: FlowBranch; soft?: boolean }>;

type StepItem = {
  step: AppiumRecordedStep;
  index: number;
};

type BuildFlowGraphOptions = {
  aiRecognitionModelConfigured?: boolean;
  expandedStepIndex: number | null;
  selectedCopyIndexes: number[];
  copyMode: boolean;
  deleteMode?: boolean;
  disabled?: boolean;
  removeDisabled?: boolean;
  mergeDisabled?: boolean;
  launchingStepId?: string;
  clipboardCount?: number;
  canOpenInsertMenu: boolean;
  isStartActionDisabled: (action: InsertAction) => boolean;
  isInsertActionDisabled: (action: InsertAction) => boolean;
  isAppExecutionDisabled: (action: 'launchApp' | 'clearAppData') => boolean;
  startActionGroups: FlowActionGroup[];
  mainActionGroups: FlowActionGroup[];
  measuredNodeHeights?: Record<string, number>;
  labelStep: (step: AppiumRecordedStep) => { title: string; meta: string; note?: string };
  isCopySelected: (index: number) => boolean;
};

type Link = {
  id: string;
  source: string;
  target: string;
  branch?: FlowBranch;
  visual?: boolean;
};

type BranchLayout = {
  yesWidth: number;
  noWidth: number;
  centerGap: number;
  totalWidth: number;
};

function nodeIdForStep(step: AppiumRecordedStep) {
  return `step:${step.id}`;
}

function branchNodeId(condition: AppiumRecordedStep, branch: FlowBranch) {
  return `branch:${condition.id}:${branch}`;
}

function splitNodeId(condition: AppiumRecordedStep) {
  return `split:${condition.id}`;
}

function insertNodeId(afterIndex: number, branch?: FlowBranch, conditionId?: string) {
  return `insert:${conditionId || 'main'}:${branch || 'main'}:${afterIndex}`;
}

function collectDescendantIds(steps: AppiumRecordedStep[], rootIds: Iterable<string>) {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    steps.forEach((step) => {
      if (step.flow?.parentConditionId && ids.has(step.flow.parentConditionId) && !ids.has(step.id)) {
        ids.add(step.id);
        changed = true;
      }
    });
  }
  return ids;
}

function directBranchItems(items: StepItem[], conditionId: string, branch: FlowBranch) {
  return items.filter(({ step }) => (
    step.flow?.parentConditionId === conditionId && step.flow.parentBranch === branch
  ));
}

function mainItems(items: StepItem[]) {
  return items.filter(({ step }) => !step.flow?.parentConditionId);
}

function isDescendantStep(steps: AppiumRecordedStep[], descendantIndex: number, ancestorIndex: number) {
  const ancestorId = steps[ancestorIndex]?.id;
  let parentId = steps[descendantIndex]?.flow?.parentConditionId;
  while (ancestorId && parentId) {
    if (parentId === ancestorId) return true;
    parentId = steps.find((item) => item.id === parentId)?.flow?.parentConditionId;
  }
  return false;
}

function followingMainStepId(items: StepItem[], index: number) {
  return items.slice(index + 1).find(({ step }) => !step.flow?.parentConditionId)?.step.id || '';
}

function addUniqueLink(links: Link[], seen: Set<string>, link: Link) {
  if (!link.target || link.source === link.target) return;
  const key = `${link.source}->${link.target}:${link.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  links.push(link);
}

function branchConnectionTargetId(items: StepItem[], condition: AppiumRecordedStep, branch: FlowBranch) {
  const branchItems = directBranchItems(items, condition.id, branch);
  if (branchItems.length) {
    const last = branchItems[branchItems.length - 1].step;
    return defaultKind(last) === 'condition' ? '' : last.flow?.successTargetId || '';
  }
  const targetId = branch === 'yes' ? condition.flow?.yesTargetId : condition.flow?.noTargetId;
  const target = items.find(({ step }) => step.id === targetId)?.step;
  return target && target.flow?.parentConditionId === condition.flow?.parentConditionId ? target.id : '';
}

function estimateTextLines(text: string | undefined, charsPerLine: number) {
  if (!text) return 0;
  return text.split('\n').reduce((total, line) => (
    total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine))
  ), 0);
}

function estimateStepNodeHeight(label: { title: string; meta: string; note?: string }) {
  const titleLines = estimateTextLines(label.title, 20);
  const metaLines = estimateTextLines(label.meta, 24);
  const noteLines = estimateTextLines(label.note, 24);
  const textHeight = titleLines * 19 + metaLines * 17 + noteLines * 17;
  return Math.max(FLOW_STEP_NODE_HEIGHT, 34 + textHeight);
}

function withLaunchAppAction(groups: FlowActionGroup[]) {
  if (groups.some((group) => group.actions.some((action) => action.type === 'launchApp'))) return groups;
  const launchAction = { type: 'launchApp' as const, label: '启动 App' };
  let added = false;
  const nextGroups = groups.map((group) => {
    if (group.title !== '设备操作') return group;
    added = true;
    return {
      ...group,
      actions: [...group.actions, launchAction],
    };
  });
  return added ? nextGroups : [...nextGroups, { title: '设备操作', actions: [launchAction] }];
}

export function buildFlowGraph(
  steps: AppiumRecordedStep[],
  options: BuildFlowGraphOptions,
) {
  const items = steps.map((step, index) => ({ step, index }));
  const nodes: FlowGraphNode[] = [];
  const links: Link[] = [];
  const layoutLinks: Link[] = [];
  const seenLinks = new Set<string>();
  const allMainItems = mainItems(items);
  const branchLayouts = new Map<string, BranchLayout>();
  const measuringBranches = new Set<string>();

  function conditionBranchLayout(condition: AppiumRecordedStep): BranchLayout {
    const cached = branchLayouts.get(condition.id);
    if (cached) return cached;
    if (measuringBranches.has(condition.id)) {
      return {
        yesWidth: FLOW_STEP_NODE_WIDTH,
        noWidth: FLOW_STEP_NODE_WIDTH,
        centerGap: FLOW_BRANCH_MIN_SPREAD * 2,
        totalWidth: FLOW_BRANCH_MIN_SPREAD * 2 + FLOW_STEP_NODE_WIDTH,
      };
    }

    measuringBranches.add(condition.id);
    const branchWidth = (branch: FlowBranch) => Math.max(
      FLOW_STEP_NODE_WIDTH,
      ...directBranchItems(items, condition.id, branch).map(({ step }) => (
        defaultKind(step) === 'condition'
          ? conditionBranchLayout(step).totalWidth
          : FLOW_STEP_NODE_WIDTH
      )),
    );
    const yesWidth = branchWidth('yes');
    const noWidth = branchWidth('no');
    const centerGap = Math.max(
      FLOW_BRANCH_MIN_SPREAD * 2,
      yesWidth / 2 + noWidth / 2 + FLOW_BRANCH_SUBTREE_GAP,
    );
    const sideExtent = Math.max(
      centerGap / 2 + yesWidth / 2,
      centerGap / 2 + noWidth / 2,
    );
    const layout = {
      yesWidth,
      noWidth,
      centerGap,
      totalWidth: Math.max(FLOW_STEP_NODE_WIDTH, sideExtent * 2),
    };
    measuringBranches.delete(condition.id);
    branchLayouts.set(condition.id, layout);
    return layout;
  }

  items
    .filter(({ step }) => defaultKind(step) === 'condition')
    .forEach(({ step }) => conditionBranchLayout(step));

  const addNode = (node: FlowGraphNode) => {
    nodes.push({
      ...node,
      dimensions: {
        width: Number(node.width) || FLOW_STEP_NODE_WIDTH,
        height: Number(node.height) || FLOW_STEP_NODE_HEIGHT,
      },
    } as FlowGraphNode);
  };
  const addVisibleLink = (source: string, target: string, branch?: FlowBranch) => {
    addUniqueLink(links, seenLinks, {
      id: `e:${source}:${target}:${branch || 'main'}`,
      source,
      target,
      branch,
      visual: true,
    });
  };
  const addLayoutLink = (source: string, target: string) => {
    layoutLinks.push({ id: `layout:${source}:${target}`, source, target });
  };

  const addInsertNode = (
    afterIndex: number,
    branch?: FlowBranch,
    condition?: StepItem,
  ) => {
    const id = insertNodeId(afterIndex, branch, condition?.step.id);
    const isStartInsert = afterIndex < 0 && !branch;
    const previousStep = afterIndex >= 0 ? steps[afterIndex] : undefined;
    const canLaunchAfterClearAppData = !isStartInsert
      && !branch
      && previousStep?.type === 'clearAppData'
      && !steps.some((step) => step.type === 'launchApp');
    addNode({
      id,
      type: 'flow-node',
      position: { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      width: FLOW_INSERT_NODE_SIZE,
      height: FLOW_INSERT_NODE_SIZE,
      selectable: false,
      draggable: false,
      connectable: false,
      data: {
        kind: 'insert',
        actionGroups: isStartInsert
          ? options.startActionGroups
          : canLaunchAfterClearAppData
            ? withLaunchAppAction(options.mainActionGroups)
            : options.mainActionGroups,
        afterIndex,
        branch,
        branchLabel: branch && condition ? flowBranchLabel(condition.step, branch) : undefined,
        conditionIndex: condition?.index,
        clipboardCount: options.clipboardCount,
        canOpenInsertMenu: options.canOpenInsertMenu,
        isActionDisabled: isStartInsert ? options.isStartActionDisabled : options.isInsertActionDisabled,
      },
    });
    return id;
  };

  const addStepNode = (item: StepItem) => {
    const id = nodeIdForStep(item.step);
    const flowKind = defaultKind(item.step);
    const label = options.labelStep(item.step);
    // 字数估算仅用于首次布局，不强制卡片高度；实际换行由浏览器决定。
    const cardMinHeight = FLOW_STEP_NODE_HEIGHT;
    const estimatedCardHeight = estimateStepNodeHeight(label);
    const estimatedNodeHeight = options.expandedStepIndex === item.index
      ? estimatedCardHeight + FLOW_EXPANDED_NODE_HEIGHT
      : estimatedCardHeight;
    const nodeHeight = Math.max(cardMinHeight, Math.ceil(options.measuredNodeHeights?.[id] || estimatedNodeHeight));
    addNode({
      id,
      type: 'flow-node',
      position: { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      width: FLOW_STEP_NODE_WIDTH,
      height: nodeHeight,
      selectable: false,
      draggable: false,
      connectable: false,
      data: {
        kind: 'step',
        step: item.step,
        index: item.index,
        flowKind,
        title: label.title,
        meta: label.meta,
        note: label.note,
        cardMinHeight,
        expanded: options.expandedStepIndex === item.index,
        selected: options.isCopySelected(item.index),
        copyMode: options.copyMode,
        deleteMode: options.deleteMode,
        disabled: item.step.type === 'launchApp' || item.step.type === 'clearAppData'
          ? options.isAppExecutionDisabled(item.step.type)
          : item.step.type === 'aiRecognition' ? options.isInsertActionDisabled('aiRecognition') : options.disabled,
        removeDisabled: options.removeDisabled,
        mergeDisabled: options.mergeDisabled,
        launching: options.launchingStepId === item.step.id,
        canCopy: item.step.type !== 'launchApp'
          && item.step.type !== 'clearAppData'
          && item.step.visualChange?.role !== 'end',
        canEditInput: item.step.type === 'input' || item.step.type === 'inputIfExists',
        canExecute: item.step.type === 'launchApp' || item.step.type === 'clearAppData' || item.step.type === 'aiRecognition',
        missingAiModel: item.step.type === 'aiRecognition' && !options.aiRecognitionModelConfigured,
      },
    });
  };

  const addBranchNode = (condition: StepItem, branch: FlowBranch) => {
    const id = branchNodeId(condition.step, branch);
    const width = condition.step.type === 'textClick' ? 116 : isBooleanCondition(condition.step) ? 56 : FLOW_BRANCH_NODE_WIDTH;
    addNode({
      id,
      type: 'flow-node',
      position: { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      width,
      height: FLOW_BRANCH_NODE_HEIGHT,
      selectable: false,
      draggable: false,
      connectable: false,
      data: { kind: 'branch', branch, label: flowBranchLabel(condition.step, branch), width, conditionIndex: condition.index },
    });
    return id;
  };

  const addSplitNode = (condition: StepItem) => {
    const id = splitNodeId(condition.step);
    addNode({
      id,
      type: 'flow-node',
      position: { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      width: FLOW_SPLIT_NODE_SIZE,
      height: FLOW_SPLIT_NODE_SIZE,
      selectable: false,
      draggable: false,
      connectable: false,
      data: { kind: 'split' },
    });
    return id;
  };

  addNode({
    id: 'start',
    type: 'flow-node',
    position: { x: 0, y: 0 },
    sourcePosition: Position.Bottom,
    width: FLOW_START_NODE_WIDTH,
    height: FLOW_START_NODE_HEIGHT,
    selectable: false,
    draggable: false,
    connectable: false,
    data: {
      kind: 'start',
      actionGroups: options.startActionGroups,
      clipboardCount: options.clipboardCount,
      canOpenInsertMenu: options.canOpenInsertMenu,
      isActionDisabled: options.isStartActionDisabled,
    },
  });

  items.forEach(addStepNode);

  const startInsertId = addInsertNode(-1);
  addVisibleLink('start', startInsertId);
  if (allMainItems[0]) addVisibleLink(startInsertId, nodeIdForStep(allMainItems[0].step));

  const stepById = new Map(items.map((item) => [item.step.id, item]));
  const wireBranch = (condition: StepItem, branch: FlowBranch, splitId: string) => {
    const labelId = addBranchNode(condition, branch);
    const directItems = directBranchItems(items, condition.step.id, branch);
    const connectedTargetId = branchConnectionTargetId(items, condition.step, branch);
    const targetStep = connectedTargetId ? stepById.get(connectedTargetId) : undefined;
    const entryInsertId = addInsertNode(condition.index, branch, condition);
    addVisibleLink(splitId, labelId, branch);
    if (directItems[0]) {
      addVisibleLink(labelId, entryInsertId, branch);
      addVisibleLink(entryInsertId, nodeIdForStep(directItems[0].step), branch);
    } else {
      addVisibleLink(labelId, entryInsertId, branch);
      if (targetStep) {
        addVisibleLink(entryInsertId, nodeIdForStep(targetStep.step), branch);
      }
    }

    directItems.forEach((item, itemIndex) => {
      wireStepContinuation(item, directItems[itemIndex + 1], branch, condition);
    });
  };

  function wireStepContinuation(
    item: StepItem,
    nextSibling?: StepItem,
    branch?: FlowBranch,
    condition?: StepItem,
  ) {
    const kind = defaultKind(item.step);
    if (kind === 'condition') {
      const splitId = addSplitNode(item);
      addVisibleLink(nodeIdForStep(item.step), splitId);
      wireBranch(item, 'yes', splitId);
      wireBranch(item, 'no', splitId);
      const nextTarget = item.step.flow?.successTargetId
        ? stepById.get(item.step.flow.successTargetId)
        : nextSibling;
      if (nextTarget) addLayoutLink(nodeIdForStep(item.step), nodeIdForStep(nextTarget.step));
      return;
    }

    const targetId = item.step.flow?.successTargetId;
    const explicitTarget = targetId ? stepById.get(targetId) : undefined;
    const explicitMainTarget = explicitTarget && (!explicitTarget.step.flow?.parentConditionId
      || explicitTarget.step.flow.parentConditionId !== item.step.flow?.parentConditionId)
      ? explicitTarget
      : undefined;
    const target = explicitMainTarget || nextSibling;
    const insertId = addInsertNode(
      item.index,
      branch,
      condition,
    );
    addVisibleLink(nodeIdForStep(item.step), insertId, branch);
    if (!target) return;
    if (branch && explicitMainTarget) {
      addVisibleLink(insertId, nodeIdForStep(target.step), branch);
      return;
    }
    addVisibleLink(insertId, nodeIdForStep(target.step), branch);
  }

  allMainItems.forEach((item, index) => {
    wireStepContinuation(item, allMainItems[index + 1]);
    if (defaultKind(item.step) === 'condition' && allMainItems[index + 1]) {
      addLayoutLink(nodeIdForStep(item.step), nodeIdForStep(allMainItems[index + 1].step));
    }
  });

  const selectedDescendantIds = collectDescendantIds(
    steps,
    options.selectedCopyIndexes.map((index) => steps[index]?.id).filter((id): id is string => Boolean(id)),
  );
  nodes.forEach((node) => {
    const data = node.data;
    if (!data || data.kind !== 'step') return;
    data.selected = data.selected || selectedDescendantIds.has(data.step.id);
  });

  const dagreGraph = new dagreApi.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: 'TB',
    nodesep: 90,
    edgesep: 24,
    ranksep: 58,
    marginx: 36,
    marginy: 28,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: Number(node.width) || FLOW_STEP_NODE_WIDTH,
      height: Number(node.height) || FLOW_STEP_NODE_HEIGHT,
    });
  });
  [...links, ...layoutLinks].forEach((link) => {
    dagreGraph.setEdge(link.source, link.target, { weight: link.visual ? 2 : 1 });
  });
  dagreApi.layout(dagreGraph);

  const positionedNodes = nodes.map((node) => {
    const layoutNode = dagreGraph.node(node.id);
    const width = Number(node.width) || FLOW_STEP_NODE_WIDTH;
    const height = Number(node.height) || FLOW_STEP_NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: Math.round((layoutNode?.x || 0) - width / 2),
        y: Math.round((layoutNode?.y || 0) - height / 2),
      },
    };
  });

  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const nodeWidth = (node: FlowGraphNode) => Number(node.width) || FLOW_STEP_NODE_WIDTH;
  const nodeHeight = (node: FlowGraphNode) => Number(node.height) || FLOW_STEP_NODE_HEIGHT;
  const centerX = (node: FlowGraphNode) => (
    node.position.x + nodeWidth(node) / 2
  );
  const setCenterX = (node: FlowGraphNode, x: number) => {
    node.position.x = Math.round(x - nodeWidth(node) / 2);
  };
  const canAlignStepAfterFlowPoint = (sourceNode: FlowGraphNode, stepNode: FlowGraphNode) => {
    if (stepNode.data?.kind !== 'step') return false;
    return sourceNode.data?.kind === 'insert' || sourceNode.data?.kind === 'branch';
  };
  const outgoingLinks = [...links, ...layoutLinks].reduce((map, link) => {
    const targets = map.get(link.source) || [];
    targets.push(link.target);
    map.set(link.source, targets);
    return map;
  }, new Map<string, string[]>());
  const moveNodeTree = (rootId: string, deltaY: number) => {
    const queue = [rootId];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const node = nodeById.get(id);
      if (node) node.position.y = Math.round(node.position.y + deltaY);
      (outgoingLinks.get(id) || []).forEach((targetId) => queue.push(targetId));
    }
  };
  const collisionOrder = (node: FlowGraphNode) => {
    const data = node.data;
    if (data?.kind === 'step') return data.index;
    if (data?.kind === 'insert') return data.afterIndex + 0.5;
    if (data?.kind === 'branch') return data.conditionIndex + (data.branch === 'yes' ? 0.1 : 0.2);
    return -1;
  };
  const resolveStepCollisions = () => {
    for (let pass = 0; pass < 12; pass += 1) {
      let moved = false;
      const layoutNodes = positionedNodes.filter((node) => (
        node.data?.kind === 'step' || node.data?.kind === 'insert' || node.data?.kind === 'branch'
      ));
      for (let aIndex = 0; aIndex < layoutNodes.length; aIndex += 1) {
        for (let bIndex = aIndex + 1; bIndex < layoutNodes.length; bIndex += 1) {
          const a = layoutNodes[aIndex];
          const b = layoutNodes[bIndex];
          const xOverlap = Math.min(a.position.x + nodeWidth(a), b.position.x + nodeWidth(b))
            - Math.max(a.position.x, b.position.x);
          const yOverlap = Math.min(a.position.y + nodeHeight(a), b.position.y + nodeHeight(b))
            - Math.max(a.position.y, b.position.y);
          if (xOverlap <= 4 || yOverlap <= 4) continue;

          const movingNode = collisionOrder(a) > collisionOrder(b) ? a : b;
          const blockingNode = movingNode === a ? b : a;
          const nextY = blockingNode.position.y + nodeHeight(blockingNode) + FLOW_STANDARD_LINE_GAP;
          if (movingNode.position.y >= nextY) continue;
          moveNodeTree(movingNode.id, nextY - movingNode.position.y);
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  const resolveInsertCrowding = () => {
    for (let pass = 0; pass < 8; pass += 1) {
      let moved = false;
      const insertNodes = positionedNodes.filter((node) => node.data?.kind === 'insert');
      const stepNodes = positionedNodes.filter((node) => node.data?.kind === 'step');
      for (let aIndex = 0; aIndex < insertNodes.length; aIndex += 1) {
        for (let bIndex = aIndex + 1; bIndex < insertNodes.length; bIndex += 1) {
          const a = insertNodes[aIndex];
          const b = insertNodes[bIndex];
          if (Math.abs(centerX(a) - centerX(b)) > 2) continue;
          const upper = a.position.y <= b.position.y ? a : b;
          const lower = upper === a ? b : a;
          const hasStepBetween = stepNodes.some((stepNode) => {
            const stepLeft = stepNode.position.x;
            const stepRight = stepNode.position.x + nodeWidth(stepNode);
            const columnX = centerX(a);
            return columnX >= stepLeft
              && columnX <= stepRight
              && stepNode.position.y < lower.position.y
              && stepNode.position.y + nodeHeight(stepNode) > upper.position.y + nodeHeight(upper);
          });
          if (hasStepBetween) continue;
          const gap = lower.position.y - (upper.position.y + nodeHeight(upper));
          const minGap = FLOW_INSERT_NODE_SIZE + FLOW_STANDARD_LINE_GAP * 3;
          const minInlineGap = FLOW_INSERT_NODE_SIZE + FLOW_STANDARD_LINE_GAP * 6;

          const movingNode = collisionOrder(a) > collisionOrder(b) ? a : b;
          const blockingNode = movingNode === a ? b : a;
          if (gap < minInlineGap) {
            const side = movingNode.data?.kind === 'insert' && movingNode.data.branch === 'no' ? 1 : -1;
            setCenterX(movingNode, centerX(movingNode) + side * (FLOW_INSERT_NODE_SIZE + FLOW_STANDARD_LINE_GAP * 2));
            moved = true;
            continue;
          }

          const nextY = Math.max(
            blockingNode.position.y + nodeHeight(blockingNode) + minGap,
            lower.position.y + Math.max(0, minGap - gap),
          );
          if (movingNode.position.y >= nextY) continue;
          moveNodeTree(movingNode.id, nextY - movingNode.position.y);
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  // 按依赖顺序传递坐标，避免固定轮数只对齐长分支的前半段。
  // 旧脚本若含回边，保留 Dagre 的纵向顺序，避免拓扑排序抛错。
  const orderedNodeIds = dagreApi.graphlib.alg.isAcyclic(dagreGraph)
    ? dagreApi.graphlib.alg.topsort(dagreGraph)
    : [...positionedNodes].sort((a, b) => a.position.y - b.position.y).map((node) => node.id);
  const nodeOrder = new Map(orderedNodeIds.map((id, index) => [id, index]));
  const orderedLinks = [...links].sort((a, b) => (
    (nodeOrder.get(a.source) || 0) - (nodeOrder.get(b.source) || 0)
  ));
  // 公共起点从两侧汇入，不能被最后一条分支连线拉到左列或右列。
  const joins = new Map<string, string>();
  items.forEach(({ step }) => {
    const target = step.flow?.successTargetId && stepById.get(step.flow.successTargetId);
    if (defaultKind(step) === 'condition' && target && !joins.has(nodeIdForStep(target.step))) {
      joins.set(nodeIdForStep(target.step), nodeIdForStep(step));
    }
  });
  const alignVisibleChainGeometry = () => {
    orderedLinks.forEach((link) => {
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target?.data) return;
      const joinOwner = joins.get(target.id);
      if (joinOwner && target.id !== joinOwner) {
        const incoming = links.filter((edge) => edge.target === target.id).map((edge) => nodeById.get(edge.source)!).filter(Boolean);
        const owner = nodeById.get(joinOwner);
        if (owner && incoming.length) {
          target.position.y = Math.round(Math.max(...incoming.map((node) => node.position.y + nodeHeight(node))) + FLOW_STANDARD_LINE_GAP * 2);
          setCenterX(target, centerX(owner));
        }
        return;
      }
      const kind = target.data.kind;
      if (!['branch', 'split', 'insert'].includes(kind) && !canAlignStepAfterFlowPoint(source, target)) return;

      const lineGap = kind === 'split'
        ? FLOW_BRANCH_TRUNK_GAP
        : kind === 'branch' ? FLOW_BRANCH_LABEL_GAP : FLOW_STANDARD_LINE_GAP;
      target.position.y = Math.round(source.position.y + nodeHeight(source) + lineGap);
      let x = centerX(source);
      if (target.data.kind === 'branch') {
        const conditionId = steps[target.data.conditionIndex].id;
        const spread = (branchLayouts.get(conditionId)?.centerGap || FLOW_BRANCH_MIN_SPREAD * 2) / 2;
        x += target.data.branch === 'yes' ? -spread : spread;
      }
      setCenterX(target, x);
    });
  };

  alignVisibleChainGeometry();

  resolveStepCollisions();
  alignVisibleChainGeometry();
  resolveStepCollisions();
  alignVisibleChainGeometry();
  resolveStepCollisions();
  resolveInsertCrowding();
  alignVisibleChainGeometry();
  resolveStepCollisions();
  alignVisibleChainGeometry();

  const edges: FlowGraphEdge[] = links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    type: 'flow-rounded',
    sourceHandle: 'bottom',
    targetHandle: 'top',
    selectable: false,
    focusable: false,
    class: 'appium-vue-flow-edge',
    data: { branch: link.branch, merge: joins.has(link.target) },
  }));

  return { nodes: positionedNodes, edges };
}

export function canSelectCopyIndex(
  steps: AppiumRecordedStep[],
  selectedIndexes: number[],
  index: number,
) {
  if (selectedIndexes.includes(index)) return true;
  return !selectedIndexes.some((selectedIndex) => isDescendantStep(steps, index, selectedIndex));
}
