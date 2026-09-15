<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue';
import { DEFAULT_FLOW_BACKGROUND, flowBackgroundKey } from '../flow-appearance';
import { useVueFlow, VueFlow } from '@vue-flow/core';
import FlowNodeCard from './FlowNodeCard.vue';
import FlowRoundedEdge from './FlowRoundedEdge.vue';
import {
  buildFlowGraph,
  PASTE_COMMAND,
  type FlowActionGroup,
  type FlowBranch,
  type InsertAction,
} from '../flow-graph';
import type { AppiumRecordedStep } from '../types';

const flowBackground = inject(flowBackgroundKey, computed(() => DEFAULT_FLOW_BACKGROUND));

const props = defineProps<{
  aiRecognitionModelConfigured?: boolean;
  id: string;
  steps: AppiumRecordedStep[];
  expandedStepIndex: number | null;
  copyMode: boolean;
  deleteMode?: boolean;
  selectedCopyIndexes: number[];
  disabled?: boolean;
  removeDisabled?: boolean;
  mergeDisabled?: boolean;
  readonly?: boolean;
  launchingStepId?: string;
  clipboardCount?: number;
  resetViewToken?: number;
  searchTargetId?: string;
  searchFocusToken?: number;
  searchActive?: boolean;
  startActionGroups: FlowActionGroup[];
  mainActionGroups: FlowActionGroup[];
  canOpenInsertMenu: boolean;
  isStartActionDisabled: (action: InsertAction) => boolean;
  isInsertActionDisabled: (action: InsertAction) => boolean;
  isAppExecutionDisabled: (action: 'launchApp' | 'clearAppData') => boolean;
  labelStep: (step: AppiumRecordedStep) => { title: string; meta: string; note?: string };
  isCopySelected: (index: number) => boolean;
}>();

const emit = defineEmits<{
  nodeClick: [index: number];
  merge: [index: number];
  copy: [indexes: number[]];
  paste: [index: number, branch?: FlowBranch, beforeStepId?: string];
  remove: [index: number];
  insertAction: [index: number, action: InsertAction, beforeStepId?: string];
  insertBranchAction: [index: number, branch: FlowBranch, action: InsertAction];
  editInput: [index: number];
  previewLinkedScript: [index: number];
  executeStep: [index: number];
  updateStep: [index: number, step: AppiumRecordedStep];
}>();

const measuredNodeHeights = shallowRef<Record<string, number>>({});
const { fitView, updateNodeInternals, findNode, setCenter, viewport } = useVueFlow(props.id);
const paneReady = shallowRef(false);
let internalsFrame = 0;
let resetViewFrame = 0;
let pendingResetView = false;
let searchFrame = 0;
watch(() => [props.searchFocusToken, props.searchTargetId, props.searchActive, paneReady.value], async () => {
  if (searchFrame) cancelAnimationFrame(searchFrame);
  if (!props.searchActive || !props.searchTargetId || !paneReady.value) return;
  await nextTick();
  searchFrame = requestAnimationFrame(() => {
    const node = findNode(`step:${props.searchTargetId}`);
    if (!node || !props.searchActive) return;
    // Move only the viewport; search never rewrites graph positions or selection state.
    void setCenter(node.position.x + node.dimensions.width / 2, node.position.y + node.dimensions.height / 2, { zoom: viewport.value.zoom, duration: 0 });
  });
});

const graph = computed(() => buildFlowGraph(props.steps, {
  deleteMode: props.deleteMode,
  mergeDisabled: props.mergeDisabled,
  aiRecognitionModelConfigured: props.aiRecognitionModelConfigured,
  expandedStepIndex: props.expandedStepIndex,
  selectedCopyIndexes: props.selectedCopyIndexes,
  copyMode: props.copyMode,
  disabled: props.disabled,
  removeDisabled: props.removeDisabled,
  launchingStepId: props.launchingStepId,
  clipboardCount: props.clipboardCount,
  canOpenInsertMenu: props.canOpenInsertMenu,
  isStartActionDisabled: props.isStartActionDisabled,
  isInsertActionDisabled: props.isInsertActionDisabled,
  isAppExecutionDisabled: props.isAppExecutionDisabled,
  startActionGroups: props.startActionGroups,
  mainActionGroups: props.mainActionGroups,
  measuredNodeHeights: measuredNodeHeights.value,
  labelStep: props.labelStep,
  isCopySelected: props.isCopySelected,
}));

function handleNodeResize(payload: { id: string; height: number }) {
  const height = Math.ceil(payload.height) + 6;
  if (!height || Math.abs((measuredNodeHeights.value[payload.id] || 0) - height) < 1) return;
  measuredNodeHeights.value = {
    ...measuredNodeHeights.value,
    [payload.id]: height,
  };
  void nextTick(scheduleNodeInternalsUpdate);
  if (props.readonly) void nextTick(() => scheduleResetView());
}

function scheduleNodeInternalsUpdate() {
  if (internalsFrame) window.cancelAnimationFrame(internalsFrame);
  internalsFrame = window.requestAnimationFrame(() => {
    internalsFrame = 0;
    updateNodeInternals(graph.value.nodes.map((node) => node.id));
  });
}

function scheduleResetView(attempt = 0) {
  if (!paneReady.value) {
    pendingResetView = true;
    return;
  }
  if (resetViewFrame) window.cancelAnimationFrame(resetViewFrame);
  resetViewFrame = window.requestAnimationFrame(async () => {
    resetViewFrame = 0;
    updateNodeInternals(graph.value.nodes.map((node) => node.id));
    const fitted = await fitView({
      padding: 0.18,
      minZoom: 0.35,
      maxZoom: 1.8,
      duration: attempt ? 0 : 240,
    });
    if (!fitted && attempt < 8) scheduleResetView(attempt + 1);
  });
}

function handlePaneReady() {
  paneReady.value = true;
  if (!pendingResetView && !props.readonly) return;
  pendingResetView = false;
  void nextTick(() => scheduleResetView());
}

function flowStructureKey() {
  return props.steps.map((step) => [
    step.id,
    step.flow?.nodeKind || '',
    step.flow?.parentConditionId || '',
    step.flow?.parentBranch || '',
    step.flow?.yesTargetId || '',
    step.flow?.noTargetId || '',
    step.flow?.successTargetId || '',
  ].join(':')).join('|');
}

watch(flowStructureKey, () => {
  measuredNodeHeights.value = {};
  void nextTick(scheduleNodeInternalsUpdate);
});

watch(graph, () => {
  void nextTick(scheduleNodeInternalsUpdate);
});

watch(() => props.resetViewToken, () => {
  void nextTick(scheduleResetView);
});

onBeforeUnmount(() => {
  if (searchFrame) cancelAnimationFrame(searchFrame);
  if (internalsFrame) window.cancelAnimationFrame(internalsFrame);
  if (resetViewFrame) window.cancelAnimationFrame(resetViewFrame);
  pendingResetView = false;
});

function handleInsert(payload: {
  afterIndex: number;
  action: InsertAction | typeof PASTE_COMMAND;
  branch?: FlowBranch;
  conditionIndex?: number;
  beforeStepId?: string;
}) {
  if (payload.action === PASTE_COMMAND) {
    emit('paste', payload.afterIndex, payload.branch, payload.beforeStepId);
    return;
  }
  if (payload.branch && payload.conditionIndex !== undefined) {
    emit('insertBranchAction', payload.afterIndex, payload.branch, payload.action);
    return;
  }
  emit('insertAction', payload.afterIndex, payload.action, payload.beforeStepId);
}
</script>

<template>
  <div class="appium-flow-canvas appium-flow-canvas--vue" :style="{ '--flow-background': flowBackground }">
    <VueFlow
      :id="id"
      class="appium-vue-flow"
      :nodes="graph.nodes"
      :edges="graph.edges"
      :fit-view-on-init="true"
      :min-zoom="0.35"
      :max-zoom="1.8"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :only-render-visible-elements="false"
      :pan-on-drag="true"
      :zoom-on-scroll="true"
      zoom-activation-key-code="Control"
      :zoom-on-double-click="false"
      :prevent-scrolling="false"
      no-drag-class-name="nodrag"
      no-pan-class-name="nopan"
      @pane-ready="handlePaneReady"
    >
      <template #node-flow-node="{ id: nodeId, data }">
        <FlowNodeCard
          :steps="steps"
          :node-id="nodeId"
          :data="data"
          :readonly="props.readonly"
          :search-highlighted="nodeId === `step:${searchTargetId}`"
          @node-click="emit('nodeClick', $event)"
          @copy="emit('copy', [$event])"
          @remove="emit('remove', $event)"
          @edit-input="emit('editInput', $event)"
          @execute="emit('executeStep', $event)"
          @insert="handleInsert"
          @update-step="emit('updateStep', $event.index, $event.step)"
          @merge="emit('merge', $event)"
          @preview-linked-script="emit('previewLinkedScript', $event)"
          @resize="handleNodeResize"
        />
      </template>
      <template #edge-flow-rounded="edgeProps">
        <FlowRoundedEdge v-bind="edgeProps" />
      </template>
    </VueFlow>
  </div>
</template>
