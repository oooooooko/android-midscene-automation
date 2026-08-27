<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import { Aim, CopyDocument, FullScreen } from '@element-plus/icons-vue';
import type { AppiumRecordedStep } from '../types';
import { createFlowClipboard } from '../flow-copy';
import FlowCanvas from './FlowCanvas.vue';
import { labelFlowStep } from '../flow-labels';
import type { FlowActionGroup, FlowBranch, InsertAction } from '../flow-graph';

const props = defineProps<{
  steps: AppiumRecordedStep[];
  disabled?: boolean;
  removeDisabled?: boolean;
  allowedLockedActions?: InsertAction[];
  launchingStepId?: string;
  clipboardCount?: number;
}>();

const emit = defineEmits<{
  remove: [index: number];
  copy: [indexes: number[]];
  paste: [index: number, branch?: FlowBranch];
  addDelay: [index?: number];
  insertAction: [index: number, action: InsertAction];
  insertBranchAction: [index: number, branch: FlowBranch, action: InsertAction];
  editInput: [index: number];
  previewLinkedScript: [index: number];
  executeStep: [index: number];
  updateStep: [index: number, step: AppiumRecordedStep];
}>();

const expandedStepIndex = shallowRef<number | null>(null);
const copyMode = shallowRef(false);
const selectedCopyIndexes = shallowRef<number[]>([]);
const flowDialogVisible = shallowRef(false);
const mainResetViewToken = shallowRef(0);

const insertActionGroups: FlowActionGroup[] = [
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
      { type: 'clearAppData', label: '清理 App 缓存' },
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
    actions: [{ type: 'runScript', label: '连接脚本' }],
  },
];

const mainActionGroups = insertActionGroups.map((group) => ({
  ...group,
  actions: group.actions.filter((action) => action.type !== 'launchApp' && action.type !== 'clearAppData'),
}));
const startActionGroups = insertActionGroups;
const hasLaunchAppStep = computed(() => props.steps.some((step) => step.type === 'launchApp'));
const hasClearAppDataStep = computed(() => props.steps.some((step) => step.type === 'clearAppData'));

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
  if (step.type === 'launchApp' || step.type === 'clearAppData') {
    ElMessage.warning('App 初始化节点不能复制');
    return;
  }
  if (selectedCopyIndexes.value.includes(index)) {
    selectedCopyIndexes.value = selectedCopyIndexes.value.filter((item) => item !== index);
    return;
  }
  if (selectedCopyIndexes.value.some((item) => isDescendantStep(index, item))) {
    ElMessage.info('该子节点已随判断节点选中');
    return;
  }
  const candidate = [
    ...selectedCopyIndexes.value.filter((item) => !isDescendantStep(item, index)),
    index,
  ].sort((left, right) => left - right);
  try {
    createFlowClipboard(props.steps, candidate);
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '当前节点不能一起复制');
    return;
  }
  selectedCopyIndexes.value = candidate;
}

function handleNodeClick(index: number) {
  if (copyMode.value) {
    toggleCopySelection(index);
    return;
  }
  const step = props.steps[index];
  if (
    expandedStepIndex.value !== index
    && (step?.type === 'input' || step?.type === 'inputIfExists')
  ) {
    emit('editInput', index);
  }
  expandedStepIndex.value = expandedStepIndex.value === index ? null : index;
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

function resetMainFlowPosition() {
  mainResetViewToken.value += 1;
}

function canOpenInsertMenu() {
  return !props.disabled || Boolean(props.allowedLockedActions?.length);
}

function isInsertActionDisabled(action: InsertAction) {
  return Boolean(props.disabled && !props.allowedLockedActions?.includes(action));
}

function isStartActionDisabled(action: InsertAction) {
  return (action === 'launchApp' && hasLaunchAppStep.value)
    || (action === 'clearAppData' && hasClearAppDataStep.value)
    || isInsertActionDisabled(action);
}

function isAppExecutionDisabled(action: 'launchApp' | 'clearAppData') {
  return Boolean(props.disabled && !props.allowedLockedActions?.includes(action));
}

function updateStep(index: number, step: AppiumRecordedStep) {
  emit('updateStep', index, step);
}
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
        :icon="Aim"
        :disabled="!steps.length"
        @click="resetMainFlowPosition"
      >
        还原位置
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

    <FlowCanvas
      id="appium-flow-main"
      :steps="steps"
      :expanded-step-index="expandedStepIndex"
      :copy-mode="copyMode"
      :selected-copy-indexes="selectedCopyIndexes"
      :disabled="disabled"
      :remove-disabled="removeDisabled"
      :launching-step-id="launchingStepId"
      :clipboard-count="clipboardCount"
      :reset-view-token="mainResetViewToken"
      :start-action-groups="startActionGroups"
      :main-action-groups="mainActionGroups"
      :can-open-insert-menu="canOpenInsertMenu()"
      :is-start-action-disabled="isStartActionDisabled"
      :is-insert-action-disabled="isInsertActionDisabled"
      :is-app-execution-disabled="isAppExecutionDisabled"
      :label-step="labelFlowStep"
      :is-copy-selected="isCopySelected"
      @node-click="handleNodeClick"
      @copy="(indexes) => emit('copy', indexes)"
      @paste="(index, branch) => emit('paste', index, branch)"
      @remove="(index) => emit('remove', index)"
      @insert-action="(index, action) => emit('insertAction', index, action)"
      @insert-branch-action="(index, branch, action) => emit('insertBranchAction', index, branch, action)"
      @edit-input="(index) => emit('editInput', index)"
      @preview-linked-script="(index) => emit('previewLinkedScript', index)"
      @execute-step="(index) => emit('executeStep', index)"
      @update-step="(index, step) => updateStep(index, step)"
    />

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
      <FlowCanvas
        id="appium-flow-dialog"
        class="appium-flow-canvas--dialog"
        :steps="steps"
        :expanded-step-index="expandedStepIndex"
        :copy-mode="copyMode"
        :selected-copy-indexes="selectedCopyIndexes"
        :disabled="disabled"
        :remove-disabled="removeDisabled"
        :launching-step-id="launchingStepId"
        :clipboard-count="clipboardCount"
        :start-action-groups="startActionGroups"
        :main-action-groups="mainActionGroups"
        :can-open-insert-menu="canOpenInsertMenu()"
        :is-start-action-disabled="isStartActionDisabled"
        :is-insert-action-disabled="isInsertActionDisabled"
        :is-app-execution-disabled="isAppExecutionDisabled"
        :label-step="labelFlowStep"
        :is-copy-selected="isCopySelected"
        @node-click="handleNodeClick"
        @copy="(indexes) => emit('copy', indexes)"
        @paste="(index, branch) => emit('paste', index, branch)"
        @remove="(index) => emit('remove', index)"
        @insert-action="(index, action) => emit('insertAction', index, action)"
        @insert-branch-action="(index, branch, action) => emit('insertBranchAction', index, branch, action)"
        @edit-input="(index) => emit('editInput', index)"
        @preview-linked-script="(index) => emit('previewLinkedScript', index)"
        @execute-step="(index) => emit('executeStep', index)"
        @update-step="(index, step) => updateStep(index, step)"
      />
    </el-dialog>
  </div>
</template>
