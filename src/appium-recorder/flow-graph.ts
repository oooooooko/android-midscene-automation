import { Position, type Edge, type Node } from '@vue-flow/core';
import * as dagre from '@dagrejs/dagre';
import type { AppiumRecordedStep } from './types';

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
  | 'clearAppData'
  | 'popupCondition'
  | 'tapIfExists'
  | 'inputIfExists'
  | 'clearIfExists'
  | 'backIfExists'
  | 'waitFor'
  | 'assertExists'
  | 'assertText'
  | 'waitDisappear'
  | 'waitActivity'
  | 'runScript';

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
      disabled?: boolean;
      removeDisabled?: boolean;
      launching?: boolean;
      canCopy: boolean;
      canEditInput: boolean;
      canExecute: boolean;
    }
  | {
      kind: 'insert';
      actionGroups: FlowActionGroup[];
      afterIndex: number;
      branch?: FlowBranch;
      conditionIndex?: number;
      clipboardCount?: number;
      canOpenInsertMenu: boolean;
      isActionDisabled: (action: InsertAction) => boolean;
    }
  | {
      kind: 'branch';
      branch: FlowBranch;
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
  expandedStepIndex: number | null;
  selectedCopyIndexes: number[];
  copyMode: boolean;
  disabled?: boolean;
  removeDisabled?: boolean;
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

function defaultKind(step: AppiumRecordedStep): FlowKind {
  if (step.flow?.nodeKind) return step.flow.nodeKind;
  if (step.type === 'assertExists' || step.type === 'assertText') return 'assertion';
  return 'action';
}

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
  return target && !target.flow?.parentConditionId ? target.id : '';
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

  const addNode = (node: FlowGraphNode) => {
    nodes.push(node);
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
        actionGroups: isStartInsert ? options.startActionGroups : options.mainActionGroups,
        afterIndex,
        branch,
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
    const cardMinHeight = estimateStepNodeHeight(label);
    const estimatedNodeHeight = options.expandedStepIndex === item.index
      ? cardMinHeight + FLOW_EXPANDED_NODE_HEIGHT
      : cardMinHeight;
    const nodeHeight = Math.max(estimatedNodeHeight, Math.ceil(options.measuredNodeHeights?.[id] || 0));
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
        disabled: item.step.type === 'launchApp' || item.step.type === 'clearAppData'
          ? options.isAppExecutionDisabled(item.step.type)
          : options.disabled,
        removeDisabled: options.removeDisabled,
        launching: options.launchingStepId === item.step.id,
        canCopy: item.step.type !== 'launchApp' && item.step.type !== 'clearAppData',
        canEditInput: item.step.type === 'input' || item.step.type === 'inputIfExists',
        canExecute: item.step.type === 'launchApp' || item.step.type === 'clearAppData',
      },
    });
  };

  const addBranchNode = (condition: StepItem, branch: FlowBranch) => {
    const id = branchNodeId(condition.step, branch);
    addNode({
      id,
      type: 'flow-node',
      position: { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      width: FLOW_BRANCH_NODE_WIDTH,
      height: FLOW_BRANCH_NODE_HEIGHT,
      selectable: false,
      draggable: false,
      connectable: false,
      data: { kind: 'branch', branch, conditionIndex: condition.index },
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
    const explicitMainTarget = explicitTarget && !explicitTarget.step.flow?.parentConditionId
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
  const normalizeBranchPositions = () => {
    positionedNodes
      .filter((node) => node.data?.kind === 'split')
      .forEach((splitNode) => {
        const branchLinks = links.filter((link) => link.source === splitNode.id && link.branch);
        const yesNode = nodeById.get(branchLinks.find((link) => link.branch === 'yes')?.target || '');
        const noNode = nodeById.get(branchLinks.find((link) => link.branch === 'no')?.target || '');
        const splitX = centerX(splitNode);
        const spread = FLOW_BRANCH_MIN_SPREAD;
        if (yesNode) setCenterX(yesNode, splitX - spread);
        if (noNode) setCenterX(noNode, splitX + spread);
      });
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
  const alignVisibleChainGeometry = () => {
    for (let pass = 0; pass < 4; pass += 1) {
      links.forEach((link) => {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || !target?.data) return;
        if (!['branch', 'split'].includes(target.data.kind)) return;

        const lineGap = target.data.kind === 'split'
          ? FLOW_BRANCH_TRUNK_GAP
          : FLOW_BRANCH_LABEL_GAP;
        target.position.y = Math.round(source.position.y + nodeHeight(source) + lineGap);
        if (target.data.kind === 'split') {
          setCenterX(target, centerX(source));
        }
      });
      normalizeBranchPositions();

      links.forEach((link) => {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || target?.data?.kind !== 'insert') return;
        target.position.y = Math.round(source.position.y + nodeHeight(source) + FLOW_STANDARD_LINE_GAP);
        setCenterX(target, centerX(source));
      });
      alignableLinks.forEach((link) => {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || !target || !canAlignStepAfterFlowPoint(source, target)) return;
        target.position.y = Math.round(source.position.y + nodeHeight(source) + FLOW_STANDARD_LINE_GAP);
        setCenterX(target, centerX(source));
      });
    }
  };

  const alignableLinks = [...links, ...layoutLinks];

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
    data: { branch: link.branch },
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
