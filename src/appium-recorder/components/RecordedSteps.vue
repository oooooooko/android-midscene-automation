<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { CopyDocument, Delete, Edit, FullScreen, Link, Timer, VideoPlay } from '@element-plus/icons-vue';
import type { AppiumRecordedStep } from '../types';
import { createFlowClipboard } from '../flow-copy';
import {
  buildConditionLayouts,
  FLOW_BRANCH_GAP,
  FLOW_NODE_WIDTH,
  placeConditionLayout,
} from '../flow-layout';
import FlowStepEditor from './FlowStepEditor.vue';
import NestedConditionBranches from './NestedConditionBranches.vue';

type FlowKind = 'action' | 'condition' | 'assertion';
type BranchName = 'yes' | 'no';
type FlowViewport = 'main' | 'overview';
type StepItem = { step: AppiumRecordedStep; index: number };
const PASTE_COMMAND = '__paste_flow_nodes__';
type InsertAction =
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

const props = defineProps<{
  steps: AppiumRecordedStep[];
  disabled?: boolean;
  allowedLockedActions?: InsertAction[];
  launchingStepId?: string;
  clipboardCount?: number;
}>();

const emit = defineEmits<{
  remove: [index: number];
  copy: [indexes: number[]];
  paste: [index: number, branch?: BranchName];
  addDelay: [index?: number];
  insertAction: [index: number, action: InsertAction];
  insertBranchAction: [index: number, branch: BranchName, action: InsertAction];
  connectNext: [index: number, branch: BranchName];
  disconnectNext: [index: number, branch: BranchName];
  editInput: [index: number];
  executeStep: [index: number];
  updateStep: [index: number, step: AppiumRecordedStep];
}>();

const expandedStepIndex = shallowRef<number | null>(null);
const copyMode = shallowRef(false);
const selectedCopyIndexes = shallowRef<number[]>([]);
const flowDialogVisible = shallowRef(false);
const flowPan = reactive({ x: 0, y: 0 });
const flowScale = shallowRef(1);
const overviewPan = reactive({ x: 0, y: 0 });
const overviewScale = shallowRef(1);
const draggingViewport = shallowRef<FlowViewport | null>(null);
const flowDragMoved = shallowRef(false);
let dragStart = { pointerId: 0, x: 0, y: 0, panX: 0, panY: 0, viewport: 'main' as FlowViewport };

const branchTargetIds = computed(() => {
  const ids = new Set<string>();
  props.steps.forEach((step) => {
    if (step.flow?.parentConditionId) ids.add(step.id);
  });
  return ids;
});

const stepItems = computed<StepItem[]>(() => props.steps
  .map((step, index) => ({ step, index }))
);

const visibleStepItems = computed(() => stepItems.value
  .filter(({ step }) => !branchTargetIds.value.has(step.id)));
const hasFlowSteps = computed(() => visibleStepItems.value.length > 0);
const hasLaunchAppStep = computed(() => props.steps.some((step) => step.type === 'launchApp'));
const conditionLayouts = computed(() => buildConditionLayouts(props.steps));
const flowContentWidth = computed(() => Math.max(
  980,
  ...visibleStepItems.value.map(({ step }) => conditionLayouts.value.get(step.id)?.totalWidth || 0),
));
const flowAxisByStepId = computed(() => {
  const axes = new Map<string, number>();
  let inheritedAxis = 50;
  visibleStepItems.value.forEach(({ step }) => {
    const incomingAxes: number[] = [];
    visibleStepItems.value.forEach(({ step: condition }) => {
      if (defaultKind(condition) !== 'condition') return;
      const layout = conditionLayouts.value.get(condition.id);
      if (!layout) return;
      const placement = placeConditionLayout(
        layout,
        flowContentWidth.value,
        axes.get(condition.id) ?? inheritedAxis,
      );
      if (branchConnectionTargetId(condition, 'yes') === step.id) incomingAxes.push(placement.yesAxis);
      if (branchConnectionTargetId(condition, 'no') === step.id) incomingAxes.push(placement.noAxis);
    });
    if (incomingAxes.length) {
      inheritedAxis = incomingAxes.reduce((total, axis) => total + axis, 0) / incomingAxes.length;
    }
    axes.set(step.id, inheritedAxis);
  });
  return axes;
});

const insertActionGroups: Array<{ title: string; actions: Array<{ type: InsertAction; label: string }> }> = [
  {
    title: '组件操作',
    actions: [
      { type: 'tap', label: '录制点击' },
      { type: 'input', label: '录制输入' },
      { type: 'clearInput', label: '清空输入' },
      { type: 'coordinateTap', label: '点击坐标' },
      { type: 'longPress', label: '长按' },
    ],
  },
  {
    title: '设备操作',
    actions: [
      { type: 'keyBack', label: '系统返回' },
      { type: 'keyHome', label: 'Home 键' },
      { type: 'keyRecent', label: '最近任务' },
      { type: 'keyPower', label: '电源键' },
      { type: 'swipe', label: '滑动' },
      { type: 'pinch', label: '双指缩放' },
      { type: 'launchApp', label: '启动 App' },
    ],
  },
  {
    title: '等待断言',
    actions: [
      { type: 'delay', label: '添加延时' },
      { type: 'popupCondition', label: '判断存在' },
      { type: 'tapIfExists', label: '存在则点击' },
      { type: 'inputIfExists', label: '存在则输入' },
      { type: 'clearIfExists', label: '存在则清空' },
      { type: 'backIfExists', label: '存在则返回' },
      { type: 'waitFor', label: '等待出现' },
      { type: 'assertExists', label: '断言存在' },
      { type: 'assertText', label: '断言文本' },
      { type: 'waitDisappear', label: '等待元素消失' },
      { type: 'waitActivity', label: '等待 Activity' },
    ],
  },
  {
    title: '流程控制',
    actions: [
      { type: 'runScript', label: '连接脚本' },
    ],
  },
];

const mainActionGroups = insertActionGroups.map((group) => ({
  ...group,
  actions: group.actions.filter((action) => action.type !== 'launchApp'),
}));

const startActionGroups = insertActionGroups;

function stepMeta(step: AppiumRecordedStep) {
  if (step.type === 'delay') return `${step.timeoutMs || 1000}ms`;
  if (step.type === 'input' || step.type === 'inputIfExists') return `输入内容：${step.value || '空'}`;
  if (defaultKind(step) === 'condition' && step.value) {
    return `${step.flow?.textMatch === 'exact' ? '精准匹配' : '模糊匹配'}：${step.value}`;
  }
  if (step.contextSelector && step.selector) {
    return `父级 ${step.contextSelector.strategy} ${step.contextSelector.value || ''} + 子级 ${step.selector.strategy} ${step.selector.value || ''}`;
  }
  if (step.type === 'key') return `keyCode ${step.keyCode || ''}`;
  if (step.type === 'waitActivity') return step.value || '';
  if (step.type === 'launchApp') return step.value || '';
  if (step.type === 'runScript') return step.value ? `脚本 ${step.value}` : '';
  if (step.type === 'screenshot') return '保存当前截图';
  if (step.type === 'swipe') {
    const swipe = step.swipe;
    return swipe ? `[${swipe.startX},${swipe.startY}] -> [${swipe.endX},${swipe.endY}]` : '';
  }
  if (step.type === 'pinch') return step.pinch?.direction === 'out' ? '放大' : '缩小';
  if (step.type === 'longPress') return `${step.fallback?.centerX || ''},${step.fallback?.centerY || ''}`;
  if (step.type === 'coordinateTap') return `${step.fallback?.centerX || ''},${step.fallback?.centerY || ''}`;
  if (step.type === 'assertText') return step.value || '';
  return `${step.selector?.strategy || ''} ${step.selector?.value || ''}`;
}

function defaultKind(step: AppiumRecordedStep): FlowKind {
  if (step.flow?.nodeKind) return step.flow.nodeKind;
  if (step.type === 'assertExists' || step.type === 'assertText') return 'assertion';
  return 'action';
}

function kindLabel(kind: FlowKind) {
  return {
    action: '操作',
    condition: '判断',
    assertion: '校验',
  }[kind];
}

function typeLabel(step: AppiumRecordedStep) {
  const labelMap: Partial<Record<AppiumRecordedStep['type'], string>> = {
    tap: '点击',
    input: '输入',
    tapIfExists: '存在则点击',
    inputIfExists: '存在则输入',
    clearIfExists: '存在则清空',
    backIfExists: '存在则返回',
    clearInput: '清空',
    waitFor: '等待出现',
    waitDisappear: '等待消失',
    assertExists: '断言存在',
    assertText: '断言文本',
    key: '按键',
    waitActivity: '等待 Activity',
    delay: '延时',
    coordinateTap: '坐标点击',
    swipe: '滑动',
    screenshot: '截图',
    launchApp: '启动 APP',
    longPress: '长按',
    pinch: '双指缩放',
    runScript: '连接脚本',
  };
  return labelMap[step.type] || step.type;
}

function targetLabel(id?: string) {
  if (!id) return '结束';
  const index = props.steps.findIndex((step) => step.id === id);
  if (index < 0) return '未找到目标';
  return props.steps[index].label;
}

function branchStepItems(step: AppiumRecordedStep, branch: BranchName) {
  return stepItems.value.filter((item) => (
    item.step.flow?.parentConditionId === step.id
    && item.step.flow?.parentBranch === branch
  ));
}

function branchConnectionTargetId(step: AppiumRecordedStep, branch: BranchName) {
  const branchItems = branchStepItems(step, branch);
  if (branchItems.length) {
    return branchItems[branchItems.length - 1]?.step.flow?.successTargetId || '';
  }
  const targetId = branch === 'yes' ? step.flow?.yesTargetId : step.flow?.noTargetId;
  const target = props.steps.find((item) => item.id === targetId);
  return target && !target.flow?.parentConditionId ? target.id : '';
}

function hasBranchConnection(step: AppiumRecordedStep) {
  return Boolean(
    branchConnectionTargetId(step, 'yes')
    || branchConnectionTargetId(step, 'no'),
  );
}

function hasFollowingMainStep(index: number) {
  return props.steps.slice(index + 1).some((step) => !step.flow?.parentConditionId);
}

function hasFollowingVisibleStep(step: AppiumRecordedStep) {
  const index = visibleStepItems.value.findIndex((item) => item.step.id === step.id);
  return index >= 0 && index < visibleStepItems.value.length - 1;
}

function shouldShowBranchConnect(index: number, step: AppiumRecordedStep, branch: BranchName) {
  return Boolean(branchConnectionTargetId(step, branch)) || hasFollowingMainStep(index);
}

function flowAxis(step: AppiumRecordedStep) {
  return flowAxisByStepId.value.get(step.id) || 50;
}

function flowAxisStyle(step: AppiumRecordedStep) {
  return { '--flow-axis': `${flowAxis(step)}%` };
}

function conditionLayout(step: AppiumRecordedStep) {
  return conditionLayouts.value.get(step.id) || {
    yesWidth: FLOW_NODE_WIDTH,
    noWidth: FLOW_NODE_WIDTH,
    totalWidth: FLOW_NODE_WIDTH * 2 + FLOW_BRANCH_GAP,
    yesAxis: 25,
    noAxis: 75,
  };
}

function branchAxis(step: AppiumRecordedStep, branch: BranchName) {
  const layout = conditionLayout(step);
  const placement = placeConditionLayout(layout, flowContentWidth.value, flowAxis(step));
  return branch === 'yes' ? placement.yesAxis : placement.noAxis;
}

function branchLayoutStyle(step: AppiumRecordedStep) {
  const layout = conditionLayout(step);
  const placement = placeConditionLayout(layout, flowContentWidth.value, flowAxis(step));
  return {
    width: `${layout.totalWidth}px`,
    minWidth: `${layout.totalWidth}px`,
    gridTemplateColumns: `${layout.yesWidth}px ${layout.noWidth}px`,
    justifySelf: 'start',
    marginLeft: `${placement.left}px`,
  };
}

function branchPath(step: AppiumRecordedStep, branch: BranchName) {
  const layout = conditionLayout(step);
  const placement = placeConditionLayout(layout, flowContentWidth.value, flowAxis(step));
  const targetAxis = branch === 'yes' ? layout.yesAxis : layout.noAxis;
  return `M${placement.startAxis} 0 C${placement.startAxis} 16 ${targetAxis} 16 ${targetAxis} 31 L${targetAxis} 48`;
}

function mergeTargetAxis(step: AppiumRecordedStep) {
  const axes = [
    branchConnectionTargetId(step, 'yes') ? branchAxis(step, 'yes') : 0,
    branchConnectionTargetId(step, 'no') ? branchAxis(step, 'no') : 0,
  ].filter(Boolean);
  return axes.reduce((total, axis) => total + axis, 0) / axes.length;
}

function mergePath(step: AppiumRecordedStep, branch: BranchName) {
  const sourceAxis = branchAxis(step, branch);
  const targetAxis = mergeTargetAxis(step);
  return `M${sourceAxis} 0 C${sourceAxis} 20 ${targetAxis} 20 ${targetAxis} 44`;
}

function toggleBranchConnection(index: number, step: AppiumRecordedStep, branch: BranchName) {
  if (branchConnectionTargetId(step, branch)) {
    emit('disconnectNext', index, branch);
  } else {
    emit('connectNext', index, branch);
  }
}

function toggleExpanded(index: number) {
  expandedStepIndex.value = expandedStepIndex.value === index ? null : index;
}

function isDescendantStep(descendantIndex: number, ancestorIndex: number) {
  const ancestorId = props.steps[ancestorIndex]?.id;
  let parentId = props.steps[descendantIndex]?.flow?.parentConditionId;
  while (ancestorId && parentId) {
    if (parentId === ancestorId) return true;
    parentId = props.steps.find((item) => item.id === parentId)?.flow?.parentConditionId;
  }
  return false;
}

function isCopySelected(index: number) {
  return selectedCopyIndexes.value.includes(index)
    || selectedCopyIndexes.value.some((selectedIndex) => isDescendantStep(index, selectedIndex));
}

function toggleCopySelection(index: number) {
  const step = props.steps[index];
  if (!step) return;
  if (step.type === 'launchApp') {
    ElMessage.warning('启动 APP 节点不能复制');
    return;
  }
  const current = selectedCopyIndexes.value;
  if (current.includes(index)) {
    selectedCopyIndexes.value = current.filter((item) => item !== index);
    return;
  }
  if (current.some((item) => isDescendantStep(index, item))) {
    ElMessage.info('该子节点已随判断节点选中');
    return;
  }
  const effectiveCurrent = current.filter((item) => !isDescendantStep(item, index));
  const candidate = [...effectiveCurrent, index].sort((left, right) => left - right);
  try {
    createFlowClipboard(props.steps, candidate);
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '当前节点不能一起复制');
    return;
  }
  selectedCopyIndexes.value = candidate;
}

function startCopyMode() {
  copyMode.value = true;
  selectedCopyIndexes.value = [];
  expandedStepIndex.value = null;
}

function cancelCopyMode() {
  copyMode.value = false;
  selectedCopyIndexes.value = [];
}

function copySelectedNodes() {
  if (!selectedCopyIndexes.value.length) return;
  emit('copy', selectedCopyIndexes.value);
  cancelCopyMode();
}

function copySingleNode(index: number) {
  emit('copy', [index]);
}

function insertAction(index: number, command: string | number | object) {
  if (command === PASTE_COMMAND) {
    emit('paste', index);
    return;
  }
  emit('insertAction', index, command as InsertAction);
}

function insertStartAction(command: string | number | object) {
  if (command === PASTE_COMMAND) {
    emit('paste', -1);
    return;
  }
  emit('insertAction', -1, command as InsertAction);
}

function insertBranchAction(index: number, branch: BranchName, command: string | number | object) {
  if (command === PASTE_COMMAND) {
    emit('paste', index, branch);
    return;
  }
  emit('insertBranchAction', index, branch, command as InsertAction);
}

function updateStep(payload: { index: number; step: AppiumRecordedStep }) {
  emit('updateStep', payload.index, payload.step);
}

function isInsertActionDisabled(action: InsertAction) {
  return Boolean(props.disabled && !props.allowedLockedActions?.includes(action));
}

function isStartActionDisabled(action: InsertAction) {
  return (action === 'launchApp' && hasLaunchAppStep.value) || isInsertActionDisabled(action);
}

function isLaunchExecutionDisabled() {
  return Boolean(props.disabled && !props.allowedLockedActions?.includes('launchApp'));
}

function canOpenInsertMenu() {
  return !props.disabled || Boolean(props.allowedLockedActions?.length);
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('.appium-flow-node__toggle')) return false;
  return Boolean(target.closest(
    'button,input,textarea,select,.el-select,.el-input,.el-input-number',
  ));
}

function resetFlowView() {
  flowPan.x = 0;
  flowPan.y = 0;
  flowScale.value = 1;
  overviewPan.x = 0;
  overviewPan.y = 0;
  overviewScale.value = 1;
}

function viewportState(viewport: FlowViewport) {
  return viewport === 'overview'
    ? { pan: overviewPan, scale: overviewScale }
    : { pan: flowPan, scale: flowScale };
}

function handleFlowWheel(event: WheelEvent, viewport: FlowViewport) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const { pan, scale } = viewportState(viewport);
  const canvas = event.currentTarget as HTMLElement;
  const bounds = canvas.getBoundingClientRect();
  const cursorX = event.clientX - bounds.left;
  const cursorY = event.clientY - bounds.top;
  const previousScale = scale.value;
  const direction = event.deltaY < 0 ? 1 : -1;
  const nextScale = Math.min(2, Math.max(0.5, Math.round((previousScale + direction * 0.1) * 10) / 10));
  if (nextScale === previousScale) return;
  pan.x = cursorX - ((cursorX - pan.x) / previousScale) * nextScale;
  pan.y = cursorY - ((cursorY - pan.y) / previousScale) * nextScale;
  scale.value = nextScale;
}

function handleNodeClick(index: number) {
  if (flowDragMoved.value) return;
  if (copyMode.value) {
    toggleCopySelection(index);
    return;
  }
  toggleExpanded(index);
}

function startFlowDrag(event: PointerEvent, viewport: FlowViewport) {
  if (isInteractiveTarget(event.target)) return;
  const { pan } = viewportState(viewport);
  draggingViewport.value = viewport;
  flowDragMoved.value = false;
  dragStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: pan.x,
    panY: pan.y,
    viewport,
  };
}

function moveFlowDrag(event: PointerEvent, viewport: FlowViewport) {
  if (draggingViewport.value !== viewport || event.pointerId !== dragStart.pointerId) return;
  if (!flowDragMoved.value && Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y) > 4) {
    flowDragMoved.value = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  const { pan } = viewportState(viewport);
  pan.x = dragStart.panX + event.clientX - dragStart.x;
  pan.y = dragStart.panY + event.clientY - dragStart.y;
}

function stopFlowDrag(event: PointerEvent, viewport: FlowViewport) {
  if (draggingViewport.value !== viewport || event.pointerId !== dragStart.pointerId) return;
  draggingViewport.value = null;
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  window.setTimeout(() => {
    flowDragMoved.value = false;
  }, 0);
}

watch(() => props.steps.length, () => {
  resetFlowView();
});
</script>

<template>
  <div class="appium-recorded-steps-panel">
    <div class="appium-flow-toolbar">
      <template v-if="copyMode">
        <span class="appium-flow-toolbar__status">已选择 {{ selectedCopyIndexes.length }} 个节点</span>
        <el-button
          size="small"
          type="primary"
          :disabled="!selectedCopyIndexes.length"
          :icon="CopyDocument"
          @click="copySelectedNodes"
        >
          复制选中
        </el-button>
        <el-button size="small" @click="cancelCopyMode">取消</el-button>
      </template>
      <el-button
        v-else
        size="small"
        :icon="CopyDocument"
        :disabled="!steps.length"
        @click="startCopyMode"
      >
        批量复制
      </el-button>
      <el-button
        size="small"
        :icon="FullScreen"
        :disabled="!steps.length"
        @click="flowDialogVisible = true"
      >
        放大
      </el-button>
    </div>
    <div
      class="appium-flow-canvas"
      :class="{ 'appium-flow-canvas--dragging': draggingViewport === 'main' }"
      @pointerdown="startFlowDrag($event, 'main')"
      @pointermove="moveFlowDrag($event, 'main')"
      @pointerup="stopFlowDrag($event, 'main')"
      @pointercancel="stopFlowDrag($event, 'main')"
      @pointerleave="stopFlowDrag($event, 'main')"
      @wheel="handleFlowWheel($event, 'main')"
    >
      <div
        class="appium-flow-content"
        :style="{
          transform: `translate(${flowPan.x}px, ${flowPan.y}px) scale(${flowScale})`,
          width: `${flowContentWidth}px`,
          minWidth: `${flowContentWidth}px`,
          '--appium-flow-line-width': '3px',
        }"
      >
        <div class="appium-flow-start">
          <svg
            v-if="hasFlowSteps"
            class="appium-flow-line appium-flow-start__line"
            viewBox="0 0 10 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M5 0 V100" />
          </svg>
          <div class="appium-flow-start__node">开始</div>
          <el-dropdown
            trigger="click"
            :disabled="!canOpenInsertMenu()"
            max-height="320px"
            popper-class="appium-action-dropdown"
            @command="insertStartAction($event)"
          >
            <button
              type="button"
              class="appium-flow-insert"
              :disabled="!canOpenInsertMenu()"
            >
              <el-icon><Timer /></el-icon>
              <span>插入操作</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-if="clipboardCount"
                  :command="PASTE_COMMAND"
                  divided
                >
                  粘贴 {{ clipboardCount }} 个节点
                </el-dropdown-item>
                <template v-for="group in startActionGroups" :key="group.title">
                  <div class="appium-action-dropdown__group">{{ group.title }}</div>
                  <el-dropdown-item
                    v-for="action in group.actions"
                    :key="action.type"
                    :command="action.type"
                    :disabled="isStartActionDisabled(action.type)"
                  >
                    {{ action.label }}
                  </el-dropdown-item>
                </template>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div
          v-for="{ step, index } in visibleStepItems"
          :key="step.id"
          class="appium-flow-item"
          :class="{ 'appium-flow-item--condition': defaultKind(step) === 'condition' }"
          :style="flowAxisStyle(step)"
        >
          <svg
            v-if="defaultKind(step) !== 'condition' && hasFollowingVisibleStep(step)"
            class="appium-flow-line appium-flow-item__line"
            viewBox="0 0 10 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M5 0 V100" />
          </svg>
          <div
            class="appium-flow-node"
            :class="[
              `appium-flow-node--${defaultKind(step)}`,
              {
                'appium-flow-node--expanded': expandedStepIndex === index,
                'appium-flow-node--selected': isCopySelected(index),
                'appium-flow-node--copying': copyMode,
              },
            ]"
          >
            <button
              type="button"
              class="appium-flow-node__toggle"
              :aria-expanded="expandedStepIndex === index"
              @click.stop="handleNodeClick(index)"
            >
              <span class="appium-flow-node__body">
                <span class="appium-flow-node__title" :title="step.label">{{ step.label }}</span>
                <span class="appium-flow-node__meta" :title="stepMeta(step)">
                  {{ kindLabel(defaultKind(step)) }} · {{ typeLabel(step) }}
                  <template v-if="step.optional"> · 可选</template>
                  <template v-if="stepMeta(step)"> · {{ stepMeta(step) }}</template>
                </span>
                <span v-if="step.note" class="appium-flow-node__note" :title="step.note">{{ step.note }}</span>
              </span>
            </button>
            <span class="appium-flow-node__actions" @click.stop>
              <el-button
                v-if="!copyMode && step.type !== 'launchApp'"
                text
                size="small"
                :icon="CopyDocument"
                title="复制节点"
                @click="copySingleNode(index)"
              />
              <el-button
                v-if="step.type === 'launchApp'"
                text
                size="small"
                :icon="VideoPlay"
                :loading="launchingStepId === step.id"
                :disabled="isLaunchExecutionDisabled()"
                title="立即执行启动 App"
                @click="$emit('executeStep', index)"
              />
              <el-button
                v-if="step.type === 'input' || step.type === 'inputIfExists'"
                text
                size="small"
                :icon="Edit"
                :disabled="disabled"
                title="修改输入内容"
                @click="$emit('editInput', index)"
              />
              <el-button
                text
                size="small"
                :icon="Delete"
                :disabled="disabled"
                title="删除节点"
                @click="$emit('remove', index)"
              />
            </span>
          </div>

        <div
          v-if="defaultKind(step) === 'condition'"
          class="appium-flow-branches"
          :style="branchLayoutStyle(step)"
        >
          <svg class="appium-flow-branch-lines" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
            <path :d="branchPath(step, 'yes')" />
            <path :d="branchPath(step, 'no')" />
          </svg>
          <div
            class="appium-flow-branch appium-flow-branch--yes"
            :class="{ 'appium-flow-branch--connected': branchConnectionTargetId(step, 'yes') }"
          >
            <svg
              class="appium-flow-line appium-flow-branch__line"
              viewBox="0 0 10 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M5 0 V100" />
            </svg>
            <strong class="appium-flow-branch__label">是</strong>
            <div v-if="branchStepItems(step, 'yes').length" class="appium-flow-branch-steps">
              <div
                v-for="item in branchStepItems(step, 'yes')"
                :key="item.step.id"
                class="appium-flow-branch-step-group"
              >
                <div
                  class="appium-flow-node appium-flow-branch-step"
                  :class="[
                    `appium-flow-node--${defaultKind(item.step)}`,
                    {
                      'appium-flow-node--expanded': expandedStepIndex === item.index,
                      'appium-flow-node--selected': isCopySelected(item.index),
                      'appium-flow-node--copying': copyMode,
                    },
                  ]"
                >
                  <button
                    type="button"
                    class="appium-flow-node__toggle"
                    :aria-expanded="expandedStepIndex === item.index"
                    @click.stop="handleNodeClick(item.index)"
                  >
                    <span class="appium-flow-node__body">
                      <span class="appium-flow-node__title">{{ item.step.label }}</span>
                      <span class="appium-flow-node__meta">
                        {{ kindLabel(defaultKind(item.step)) }} · {{ typeLabel(item.step) }}
                        <template v-if="stepMeta(item.step)"> · {{ stepMeta(item.step) }}</template>
                      </span>
                      <span v-if="item.step.note" class="appium-flow-node__note" :title="item.step.note">{{ item.step.note }}</span>
                    </span>
                  </button>
                  <span class="appium-flow-node__actions" @click.stop>
                    <el-button
                      v-if="!copyMode"
                      text
                      size="small"
                      :icon="CopyDocument"
                      title="复制节点"
                      @click="copySingleNode(item.index)"
                    />
                    <el-button
                      text
                      size="small"
                      :icon="Delete"
                      :disabled="disabled"
                      title="删除节点"
                      @click="$emit('remove', item.index)"
                    />
                  </span>
                </div>
                <FlowStepEditor
                  v-if="expandedStepIndex === item.index"
                  :step="item.step"
                  :index="item.index"
                  :disabled="disabled"
                  @update="updateStep"
                />
                <NestedConditionBranches
                  v-if="defaultKind(item.step) === 'condition'"
                  :steps="steps"
                  :condition="item.step"
                  :condition-index="item.index"
                  :expanded-step-index="expandedStepIndex"
                  :copy-mode="copyMode"
                  :selected-copy-indexes="selectedCopyIndexes"
                  :disabled="disabled"
                  :allowed-locked-actions="allowedLockedActions"
                  :clipboard-count="clipboardCount"
                  @node-click="handleNodeClick"
                  @copy="$emit('copy', $event)"
                  @remove="$emit('remove', $event)"
                  @paste="(childIndex, childBranch) => $emit('paste', childIndex, childBranch)"
                  @insert-branch-action="(childIndex, childBranch, action) => $emit('insertBranchAction', childIndex, childBranch, action)"
                  @connect-next="(childIndex, childBranch) => $emit('connectNext', childIndex, childBranch)"
                  @disconnect-next="(childIndex, childBranch) => $emit('disconnectNext', childIndex, childBranch)"
                  @edit-input="$emit('editInput', $event)"
                  @update-step="(childIndex, childStep) => $emit('updateStep', childIndex, childStep)"
                />
              </div>
            </div>
            <span
              v-if="!branchStepItems(step, 'yes').length && !branchConnectionTargetId(step, 'yes')"
              class="appium-flow-branch__target"
            >
              {{ targetLabel(step.flow?.yesTargetId) }}
            </span>
            <div class="appium-flow-branch__actions">
            <el-dropdown
              trigger="click"
              :disabled="!canOpenInsertMenu()"
              max-height="320px"
              popper-class="appium-action-dropdown"
              @command="insertBranchAction(index, 'yes', $event)"
            >
              <el-button
                size="small"
                class="appium-flow-branch__insert"
                :disabled="!canOpenInsertMenu()"
                :icon="Timer"
                @click.stop
              >
                插入操作
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-if="clipboardCount"
                    :command="PASTE_COMMAND"
                    divided
                  >
                    粘贴 {{ clipboardCount }} 个节点
                  </el-dropdown-item>
                  <template v-for="group in mainActionGroups" :key="group.title">
                    <div class="appium-action-dropdown__group">{{ group.title }}</div>
                    <el-dropdown-item
                      v-for="action in group.actions"
                      :key="action.type"
                      :command="action.type"
                      :disabled="isInsertActionDisabled(action.type)"
                    >
                      {{ action.label }}
                    </el-dropdown-item>
                  </template>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button
              v-if="shouldShowBranchConnect(index, step, 'yes')"
              size="small"
              class="appium-flow-branch__connect"
              :icon="Link"
              :disabled="disabled"
              :title="branchConnectionTargetId(step, 'yes') ? '取消当前分支与主流程的连接' : '自动连接判断节点之后的主流程节点'"
              @click.stop="toggleBranchConnection(index, step, 'yes')"
            >
              {{ branchConnectionTargetId(step, 'yes') ? '取消连接' : '连接到下一节点' }}
            </el-button>
            </div>
          </div>
          <div
            class="appium-flow-branch appium-flow-branch--no"
            :class="{ 'appium-flow-branch--connected': branchConnectionTargetId(step, 'no') }"
          >
            <svg
              class="appium-flow-line appium-flow-branch__line"
              viewBox="0 0 10 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M5 0 V100" />
            </svg>
            <strong class="appium-flow-branch__label">否</strong>
            <div v-if="branchStepItems(step, 'no').length" class="appium-flow-branch-steps">
              <div
                v-for="item in branchStepItems(step, 'no')"
                :key="item.step.id"
                class="appium-flow-branch-step-group"
              >
                <div
                  class="appium-flow-node appium-flow-branch-step"
                  :class="[
                    `appium-flow-node--${defaultKind(item.step)}`,
                    {
                      'appium-flow-node--expanded': expandedStepIndex === item.index,
                      'appium-flow-node--selected': isCopySelected(item.index),
                      'appium-flow-node--copying': copyMode,
                    },
                  ]"
                >
                  <button
                    type="button"
                    class="appium-flow-node__toggle"
                    :aria-expanded="expandedStepIndex === item.index"
                    @click.stop="handleNodeClick(item.index)"
                  >
                    <span class="appium-flow-node__body">
                      <span class="appium-flow-node__title">{{ item.step.label }}</span>
                      <span class="appium-flow-node__meta">
                        {{ kindLabel(defaultKind(item.step)) }} · {{ typeLabel(item.step) }}
                        <template v-if="stepMeta(item.step)"> · {{ stepMeta(item.step) }}</template>
                      </span>
                      <span v-if="item.step.note" class="appium-flow-node__note" :title="item.step.note">{{ item.step.note }}</span>
                    </span>
                  </button>
                  <span class="appium-flow-node__actions" @click.stop>
                    <el-button
                      v-if="!copyMode"
                      text
                      size="small"
                      :icon="CopyDocument"
                      title="复制节点"
                      @click="copySingleNode(item.index)"
                    />
                    <el-button
                      text
                      size="small"
                      :icon="Delete"
                      :disabled="disabled"
                      title="删除节点"
                      @click="$emit('remove', item.index)"
                    />
                  </span>
                </div>
                <FlowStepEditor
                  v-if="expandedStepIndex === item.index"
                  :step="item.step"
                  :index="item.index"
                  :disabled="disabled"
                  @update="updateStep"
                />
                <NestedConditionBranches
                  v-if="defaultKind(item.step) === 'condition'"
                  :steps="steps"
                  :condition="item.step"
                  :condition-index="item.index"
                  :expanded-step-index="expandedStepIndex"
                  :copy-mode="copyMode"
                  :selected-copy-indexes="selectedCopyIndexes"
                  :disabled="disabled"
                  :allowed-locked-actions="allowedLockedActions"
                  :clipboard-count="clipboardCount"
                  @node-click="handleNodeClick"
                  @copy="$emit('copy', $event)"
                  @remove="$emit('remove', $event)"
                  @paste="(childIndex, childBranch) => $emit('paste', childIndex, childBranch)"
                  @insert-branch-action="(childIndex, childBranch, action) => $emit('insertBranchAction', childIndex, childBranch, action)"
                  @connect-next="(childIndex, childBranch) => $emit('connectNext', childIndex, childBranch)"
                  @disconnect-next="(childIndex, childBranch) => $emit('disconnectNext', childIndex, childBranch)"
                  @edit-input="$emit('editInput', $event)"
                  @update-step="(childIndex, childStep) => $emit('updateStep', childIndex, childStep)"
                />
              </div>
            </div>
            <span
              v-if="!branchStepItems(step, 'no').length && !branchConnectionTargetId(step, 'no')"
              class="appium-flow-branch__target"
            >
              {{ targetLabel(step.flow?.noTargetId) }}
            </span>
            <div class="appium-flow-branch__actions">
            <el-dropdown
              trigger="click"
              :disabled="!canOpenInsertMenu()"
              max-height="320px"
              popper-class="appium-action-dropdown"
              @command="insertBranchAction(index, 'no', $event)"
            >
              <el-button
                size="small"
                class="appium-flow-branch__insert"
                :disabled="!canOpenInsertMenu()"
                :icon="Timer"
                @click.stop
              >
                插入操作
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-if="clipboardCount"
                    :command="PASTE_COMMAND"
                    divided
                  >
                    粘贴 {{ clipboardCount }} 个节点
                  </el-dropdown-item>
                  <template v-for="group in mainActionGroups" :key="group.title">
                    <div class="appium-action-dropdown__group">{{ group.title }}</div>
                    <el-dropdown-item
                      v-for="action in group.actions"
                      :key="action.type"
                      :command="action.type"
                      :disabled="isInsertActionDisabled(action.type)"
                    >
                      {{ action.label }}
                    </el-dropdown-item>
                  </template>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button
              v-if="shouldShowBranchConnect(index, step, 'no')"
              size="small"
              class="appium-flow-branch__connect"
              :icon="Link"
              :disabled="disabled"
              :title="branchConnectionTargetId(step, 'no') ? '取消当前分支与主流程的连接' : '自动连接判断节点之后的主流程节点'"
              @click.stop="toggleBranchConnection(index, step, 'no')"
            >
              {{ branchConnectionTargetId(step, 'no') ? '取消连接' : '连接到下一节点' }}
            </el-button>
            </div>
          </div>
        </div>

        <div v-if="hasBranchConnection(step)" class="appium-flow-merge">
          <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
            <path
              v-if="branchConnectionTargetId(step, 'yes')"
              class="appium-flow-merge__yes"
              :d="mergePath(step, 'yes')"
            />
            <path
              v-if="branchConnectionTargetId(step, 'no')"
              class="appium-flow-merge__no"
              :d="mergePath(step, 'no')"
            />
          </svg>
        </div>

        <FlowStepEditor
          v-if="expandedStepIndex === index"
          :step="step"
          :index="index"
          :disabled="disabled"
          @update="updateStep"
        />

        <el-dropdown
          v-if="defaultKind(step) !== 'condition'"
          trigger="click"
          :disabled="!canOpenInsertMenu()"
          max-height="320px"
          popper-class="appium-action-dropdown"
          @command="insertAction(index, $event)"
        >
          <button
            type="button"
            class="appium-flow-insert"
            :disabled="!canOpenInsertMenu()"
          >
            <el-icon><Timer /></el-icon>
            <span>插入操作</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-if="clipboardCount"
                :command="PASTE_COMMAND"
                divided
              >
                粘贴 {{ clipboardCount }} 个节点
              </el-dropdown-item>
              <template v-for="group in mainActionGroups" :key="group.title">
                <div class="appium-action-dropdown__group">{{ group.title }}</div>
                <el-dropdown-item
                  v-for="action in group.actions"
                  :key="action.type"
                  :command="action.type"
                  :disabled="isInsertActionDisabled(action.type)"
                >
                  {{ action.label }}
                </el-dropdown-item>
              </template>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        </div>
      </div>
    </div>
    <el-dialog
      v-model="flowDialogVisible"
      title="流程总览"
      width="86vw"
      class="appium-flow-dialog"
      append-to-body
    >
      <div class="appium-flow-toolbar appium-flow-dialog__toolbar">
        <template v-if="copyMode">
          <span class="appium-flow-toolbar__status">已选择 {{ selectedCopyIndexes.length }} 个节点</span>
          <el-button
            size="small"
            type="primary"
            :disabled="!selectedCopyIndexes.length"
            :icon="CopyDocument"
            @click="copySelectedNodes"
          >
            复制选中
          </el-button>
          <el-button size="small" @click="cancelCopyMode">取消</el-button>
        </template>
        <el-button
          v-else
          size="small"
          :icon="CopyDocument"
          :disabled="!steps.length"
          @click="startCopyMode"
        >
          批量复制
        </el-button>
      </div>
      <div
        class="appium-flow-dialog-canvas"
        :class="{ 'appium-flow-dialog-canvas--dragging': draggingViewport === 'overview' }"
        @pointerdown="startFlowDrag($event, 'overview')"
        @pointermove="moveFlowDrag($event, 'overview')"
        @pointerup="stopFlowDrag($event, 'overview')"
        @pointercancel="stopFlowDrag($event, 'overview')"
        @pointerleave="stopFlowDrag($event, 'overview')"
        @wheel="handleFlowWheel($event, 'overview')"
      >
        <div
          class="appium-flow-content appium-flow-content--overview"
          :style="{
            transform: `translate(${overviewPan.x}px, ${overviewPan.y}px) scale(${overviewScale})`,
            width: `${flowContentWidth}px`,
            minWidth: `${flowContentWidth}px`,
            '--appium-flow-line-width': '3px',
          }"
        >
          <div class="appium-flow-start appium-flow-start--overview">
            <svg
              v-if="hasFlowSteps"
              class="appium-flow-line appium-flow-start__line"
              viewBox="0 0 10 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M5 0 V100" />
            </svg>
            <div class="appium-flow-start__node">开始</div>
            <el-dropdown
              trigger="click"
              :disabled="!canOpenInsertMenu()"
              max-height="320px"
              popper-class="appium-action-dropdown"
              @command="insertStartAction($event)"
            >
              <button
                type="button"
                class="appium-flow-insert"
                :disabled="!canOpenInsertMenu()"
              >
                <el-icon><Timer /></el-icon>
                <span>插入操作</span>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="clipboardCount" :command="PASTE_COMMAND" divided>
                    粘贴 {{ clipboardCount }} 个节点
                  </el-dropdown-item>
                  <template v-for="group in startActionGroups" :key="group.title">
                    <div class="appium-action-dropdown__group">{{ group.title }}</div>
                    <el-dropdown-item
                      v-for="action in group.actions"
                      :key="action.type"
                      :command="action.type"
                      :disabled="isStartActionDisabled(action.type)"
                    >
                      {{ action.label }}
                    </el-dropdown-item>
                  </template>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <div
            v-for="{ step, index } in visibleStepItems"
            :key="step.id"
            class="appium-flow-item"
            :class="{ 'appium-flow-item--condition': defaultKind(step) === 'condition' }"
            :style="flowAxisStyle(step)"
          >
            <svg
              v-if="defaultKind(step) !== 'condition' && hasFollowingVisibleStep(step)"
              class="appium-flow-line appium-flow-item__line"
              viewBox="0 0 10 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M5 0 V100" />
            </svg>
            <div
              class="appium-flow-node"
              :class="[
                `appium-flow-node--${defaultKind(step)}`,
                {
                  'appium-flow-node--expanded': expandedStepIndex === index,
                  'appium-flow-node--selected': isCopySelected(index),
                  'appium-flow-node--copying': copyMode,
                },
              ]"
            >
              <button
                type="button"
                class="appium-flow-node__toggle"
                :aria-expanded="expandedStepIndex === index"
                @click="handleNodeClick(index)"
              >
                <span class="appium-flow-node__body">
                  <span class="appium-flow-node__title" :title="step.label">{{ step.label }}</span>
                  <span class="appium-flow-node__meta" :title="stepMeta(step)">
                    {{ kindLabel(defaultKind(step)) }} · {{ typeLabel(step) }}
                    <template v-if="step.optional"> · 可选</template>
                    <template v-if="stepMeta(step)"> · {{ stepMeta(step) }}</template>
                  </span>
                  <span v-if="step.note" class="appium-flow-node__note" :title="step.note">{{ step.note }}</span>
                </span>
              </button>
              <span class="appium-flow-node__actions" @click.stop>
                <el-button
                  v-if="!copyMode && step.type !== 'launchApp'"
                  text
                  size="small"
                  :icon="CopyDocument"
                  title="复制节点"
                  @click="copySingleNode(index)"
                />
                <el-button
                  v-if="step.type === 'launchApp'"
                  text
                  size="small"
                  :icon="VideoPlay"
                  :loading="launchingStepId === step.id"
                  :disabled="isLaunchExecutionDisabled()"
                  title="立即执行启动 App"
                  @click="$emit('executeStep', index)"
                />
                <el-button
                  v-if="step.type === 'input' || step.type === 'inputIfExists'"
                  text
                  size="small"
                  :icon="Edit"
                  :disabled="disabled"
                  title="修改输入内容"
                  @click="$emit('editInput', index)"
                />
                <el-button
                  text
                  size="small"
                  :icon="Delete"
                  :disabled="disabled"
                  title="删除节点"
                  @click="$emit('remove', index)"
                />
              </span>
            </div>

            <FlowStepEditor
              v-if="expandedStepIndex === index"
              :step="step"
              :index="index"
              :disabled="disabled"
              @update="updateStep"
            />

            <div
              v-if="defaultKind(step) === 'condition'"
              class="appium-flow-branches"
              :style="branchLayoutStyle(step)"
            >
              <svg class="appium-flow-branch-lines" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
                <path :d="branchPath(step, 'yes')" />
                <path :d="branchPath(step, 'no')" />
              </svg>
              <div
                class="appium-flow-branch appium-flow-branch--yes"
                :class="{ 'appium-flow-branch--connected': branchConnectionTargetId(step, 'yes') }"
              >
                <svg
                  class="appium-flow-line appium-flow-branch__line"
                  viewBox="0 0 10 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M5 0 V100" />
                </svg>
                <strong class="appium-flow-branch__label">是</strong>
                <div v-if="branchStepItems(step, 'yes').length" class="appium-flow-branch-steps">
                  <div
                    v-for="item in branchStepItems(step, 'yes')"
                    :key="item.step.id"
                    class="appium-flow-branch-step-group"
                  >
                    <div
                      class="appium-flow-node appium-flow-branch-step"
                      :class="[
                        `appium-flow-node--${defaultKind(item.step)}`,
                        {
                          'appium-flow-node--expanded': expandedStepIndex === item.index,
                          'appium-flow-node--selected': isCopySelected(item.index),
                          'appium-flow-node--copying': copyMode,
                        },
                      ]"
                    >
                      <button
                        type="button"
                        class="appium-flow-node__toggle"
                        :aria-expanded="expandedStepIndex === item.index"
                        @click="handleNodeClick(item.index)"
                      >
                        <span class="appium-flow-node__body">
                          <span class="appium-flow-node__title">{{ item.step.label }}</span>
                          <span class="appium-flow-node__meta">
                            {{ kindLabel(defaultKind(item.step)) }} · {{ typeLabel(item.step) }}
                            <template v-if="stepMeta(item.step)"> · {{ stepMeta(item.step) }}</template>
                          </span>
                          <span v-if="item.step.note" class="appium-flow-node__note" :title="item.step.note">{{ item.step.note }}</span>
                        </span>
                      </button>
                      <span class="appium-flow-node__actions" @click.stop>
                        <el-button
                          v-if="!copyMode"
                          text
                          size="small"
                          :icon="CopyDocument"
                          title="复制节点"
                          @click="copySingleNode(item.index)"
                        />
                        <el-button
                          text
                          size="small"
                          :icon="Delete"
                          :disabled="disabled"
                          title="删除节点"
                          @click="$emit('remove', item.index)"
                        />
                      </span>
                    </div>
                    <FlowStepEditor
                      v-if="expandedStepIndex === item.index"
                      :step="item.step"
                      :index="item.index"
                      :disabled="disabled"
                      @update="updateStep"
                    />
                    <NestedConditionBranches
                      v-if="defaultKind(item.step) === 'condition'"
                      :steps="steps"
                      :condition="item.step"
                      :condition-index="item.index"
                      :expanded-step-index="expandedStepIndex"
                      :copy-mode="copyMode"
                      :selected-copy-indexes="selectedCopyIndexes"
                      :disabled="disabled"
                      :allowed-locked-actions="allowedLockedActions"
                      :clipboard-count="clipboardCount"
                      @node-click="handleNodeClick"
                      @copy="$emit('copy', $event)"
                      @remove="$emit('remove', $event)"
                      @paste="(childIndex, childBranch) => $emit('paste', childIndex, childBranch)"
                      @insert-branch-action="(childIndex, childBranch, action) => $emit('insertBranchAction', childIndex, childBranch, action)"
                      @connect-next="(childIndex, childBranch) => $emit('connectNext', childIndex, childBranch)"
                      @disconnect-next="(childIndex, childBranch) => $emit('disconnectNext', childIndex, childBranch)"
                      @edit-input="$emit('editInput', $event)"
                      @update-step="(childIndex, childStep) => $emit('updateStep', childIndex, childStep)"
                    />
                  </div>
                </div>
                <span
                  v-if="!branchStepItems(step, 'yes').length && !branchConnectionTargetId(step, 'yes')"
                  class="appium-flow-branch__target"
                >
                  {{ targetLabel(step.flow?.yesTargetId) }}
                </span>
                <div class="appium-flow-branch__actions">
                  <el-dropdown
                    trigger="click"
                    :disabled="!canOpenInsertMenu()"
                    max-height="320px"
                    popper-class="appium-action-dropdown"
                    @command="insertBranchAction(index, 'yes', $event)"
                  >
                    <el-button
                      size="small"
                      class="appium-flow-branch__insert"
                      :disabled="!canOpenInsertMenu()"
                      :icon="Timer"
                      @click.stop
                    >
                      插入操作
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-if="clipboardCount" :command="PASTE_COMMAND" divided>
                          粘贴 {{ clipboardCount }} 个节点
                        </el-dropdown-item>
                        <template v-for="group in mainActionGroups" :key="group.title">
                          <div class="appium-action-dropdown__group">{{ group.title }}</div>
                          <el-dropdown-item
                            v-for="action in group.actions"
                            :key="action.type"
                            :command="action.type"
                            :disabled="isInsertActionDisabled(action.type)"
                          >
                            {{ action.label }}
                          </el-dropdown-item>
                        </template>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                  <el-button
                    v-if="shouldShowBranchConnect(index, step, 'yes')"
                    size="small"
                    class="appium-flow-branch__connect"
                    :icon="Link"
                    :disabled="disabled"
                    @click.stop="toggleBranchConnection(index, step, 'yes')"
                  >
                    {{ branchConnectionTargetId(step, 'yes') ? '取消连接' : '连接到下一节点' }}
                  </el-button>
                </div>
              </div>
              <div
                class="appium-flow-branch appium-flow-branch--no"
                :class="{ 'appium-flow-branch--connected': branchConnectionTargetId(step, 'no') }"
              >
                <svg
                  class="appium-flow-line appium-flow-branch__line"
                  viewBox="0 0 10 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M5 0 V100" />
                </svg>
                <strong class="appium-flow-branch__label">否</strong>
                <div v-if="branchStepItems(step, 'no').length" class="appium-flow-branch-steps">
                  <div
                    v-for="item in branchStepItems(step, 'no')"
                    :key="item.step.id"
                    class="appium-flow-branch-step-group"
                  >
                    <div
                      class="appium-flow-node appium-flow-branch-step"
                      :class="[
                        `appium-flow-node--${defaultKind(item.step)}`,
                        {
                          'appium-flow-node--expanded': expandedStepIndex === item.index,
                          'appium-flow-node--selected': isCopySelected(item.index),
                          'appium-flow-node--copying': copyMode,
                        },
                      ]"
                    >
                      <button
                        type="button"
                        class="appium-flow-node__toggle"
                        :aria-expanded="expandedStepIndex === item.index"
                        @click="handleNodeClick(item.index)"
                      >
                        <span class="appium-flow-node__body">
                          <span class="appium-flow-node__title">{{ item.step.label }}</span>
                          <span class="appium-flow-node__meta">
                            {{ kindLabel(defaultKind(item.step)) }} · {{ typeLabel(item.step) }}
                            <template v-if="stepMeta(item.step)"> · {{ stepMeta(item.step) }}</template>
                          </span>
                          <span v-if="item.step.note" class="appium-flow-node__note" :title="item.step.note">{{ item.step.note }}</span>
                        </span>
                      </button>
                      <span class="appium-flow-node__actions" @click.stop>
                        <el-button
                          v-if="!copyMode"
                          text
                          size="small"
                          :icon="CopyDocument"
                          title="复制节点"
                          @click="copySingleNode(item.index)"
                        />
                        <el-button
                          text
                          size="small"
                          :icon="Delete"
                          :disabled="disabled"
                          title="删除节点"
                          @click="$emit('remove', item.index)"
                        />
                      </span>
                    </div>
                    <FlowStepEditor
                      v-if="expandedStepIndex === item.index"
                      :step="item.step"
                      :index="item.index"
                      :disabled="disabled"
                      @update="updateStep"
                    />
                    <NestedConditionBranches
                      v-if="defaultKind(item.step) === 'condition'"
                      :steps="steps"
                      :condition="item.step"
                      :condition-index="item.index"
                      :expanded-step-index="expandedStepIndex"
                      :copy-mode="copyMode"
                      :selected-copy-indexes="selectedCopyIndexes"
                      :disabled="disabled"
                      :allowed-locked-actions="allowedLockedActions"
                      :clipboard-count="clipboardCount"
                      @node-click="handleNodeClick"
                      @copy="$emit('copy', $event)"
                      @remove="$emit('remove', $event)"
                      @paste="(childIndex, childBranch) => $emit('paste', childIndex, childBranch)"
                      @insert-branch-action="(childIndex, childBranch, action) => $emit('insertBranchAction', childIndex, childBranch, action)"
                      @connect-next="(childIndex, childBranch) => $emit('connectNext', childIndex, childBranch)"
                      @disconnect-next="(childIndex, childBranch) => $emit('disconnectNext', childIndex, childBranch)"
                      @edit-input="$emit('editInput', $event)"
                      @update-step="(childIndex, childStep) => $emit('updateStep', childIndex, childStep)"
                    />
                  </div>
                </div>
                <span
                  v-if="!branchStepItems(step, 'no').length && !branchConnectionTargetId(step, 'no')"
                  class="appium-flow-branch__target"
                >
                  {{ targetLabel(step.flow?.noTargetId) }}
                </span>
                <div class="appium-flow-branch__actions">
                  <el-dropdown
                    trigger="click"
                    :disabled="!canOpenInsertMenu()"
                    max-height="320px"
                    popper-class="appium-action-dropdown"
                    @command="insertBranchAction(index, 'no', $event)"
                  >
                    <el-button
                      size="small"
                      class="appium-flow-branch__insert"
                      :disabled="!canOpenInsertMenu()"
                      :icon="Timer"
                      @click.stop
                    >
                      插入操作
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-if="clipboardCount" :command="PASTE_COMMAND" divided>
                          粘贴 {{ clipboardCount }} 个节点
                        </el-dropdown-item>
                        <template v-for="group in mainActionGroups" :key="group.title">
                          <div class="appium-action-dropdown__group">{{ group.title }}</div>
                          <el-dropdown-item
                            v-for="action in group.actions"
                            :key="action.type"
                            :command="action.type"
                            :disabled="isInsertActionDisabled(action.type)"
                          >
                            {{ action.label }}
                          </el-dropdown-item>
                        </template>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                  <el-button
                    v-if="shouldShowBranchConnect(index, step, 'no')"
                    size="small"
                    class="appium-flow-branch__connect"
                    :icon="Link"
                    :disabled="disabled"
                    @click.stop="toggleBranchConnection(index, step, 'no')"
                  >
                    {{ branchConnectionTargetId(step, 'no') ? '取消连接' : '连接到下一节点' }}
                  </el-button>
                </div>
              </div>
            </div>
            <div v-if="hasBranchConnection(step)" class="appium-flow-merge">
              <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
                <path
                  v-if="branchConnectionTargetId(step, 'yes')"
                  class="appium-flow-merge__yes"
                  :d="mergePath(step, 'yes')"
                />
                <path
                  v-if="branchConnectionTargetId(step, 'no')"
                  class="appium-flow-merge__no"
                  :d="mergePath(step, 'no')"
                />
              </svg>
            </div>
            <el-dropdown
              v-if="defaultKind(step) !== 'condition'"
              trigger="click"
              :disabled="!canOpenInsertMenu()"
              max-height="320px"
              popper-class="appium-action-dropdown"
              @command="insertAction(index, $event)"
            >
              <button
                type="button"
                class="appium-flow-insert"
                :disabled="!canOpenInsertMenu()"
              >
                <el-icon><Timer /></el-icon>
                <span>插入操作</span>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="clipboardCount" :command="PASTE_COMMAND" divided>
                    粘贴 {{ clipboardCount }} 个节点
                  </el-dropdown-item>
                  <template v-for="group in mainActionGroups" :key="group.title">
                    <div class="appium-action-dropdown__group">{{ group.title }}</div>
                    <el-dropdown-item
                      v-for="action in group.actions"
                      :key="action.type"
                      :command="action.type"
                      :disabled="isInsertActionDisabled(action.type)"
                    >
                      {{ action.label }}
                    </el-dropdown-item>
                  </template>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>
