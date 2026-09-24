<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Aim, CopyDocument, FullScreen, Close, Delete } from '@element-plus/icons-vue';
import { removeFlowSteps } from '../flow-remove';
import type { AppiumRecordedStep } from '../types';
import { createFlowClipboard } from '../flow-copy';
import FlowCanvas from './FlowCanvas.vue';
import MergeBranchesDialog from './MergeBranchesDialog.vue';
import FlowNodeSearch from './FlowNodeSearch.vue';
import { searchFlowNodes } from '../flow-search';
import { labelFlowStep } from '../flow-labels';
import type { FlowActionGroup, FlowBranch, InsertAction } from '../flow-graph';

const props = defineProps<{
  aiRecognitionModelConfigured?: boolean;
  steps: AppiumRecordedStep[];
  disabled?: boolean;
  removeDisabled?: boolean;
  mergeDisabled?: boolean;
  allowedLockedActions?: InsertAction[];
  launchingStepId?: string;
  clipboardCount?: number;
}>();

const emit = defineEmits<{
  remove: [index: number];
  copy: [indexes: number[]];
  paste: [index: number, branch?: FlowBranch, beforeStepId?: string];
  addDelay: [index?: number];
  insertAction: [index: number, action: InsertAction, beforeStepId?: string];
  insertBranchAction: [index: number, branch: FlowBranch, action: InsertAction];
  editInput: [index: number];
  previewLinkedScript: [index: number];
  executeStep: [index: number];
  updateStep: [index: number, step: AppiumRecordedStep];
  replaceSteps: [steps: AppiumRecordedStep[]];
}>();

const expandedStepIndex = shallowRef<number | null>(null);
const mergeConditionId = shallowRef('');
const copyMode = shallowRef(false);
const deleteMode = shallowRef(false);
const deleting = shallowRef(false);
const selectedCopyIndexes = shallowRef<number[]>([]);
const flowDialogVisible = shallowRef(false);
const mainResetViewToken = shallowRef(0);
const dialogResetViewToken = shallowRef(0);
const searchQuery = shallowRef('');
const searchTargetId = shallowRef('');
const searchFocusToken = shallowRef(0);
const searchResults = computed(() => searchFlowNodes(props.steps, searchQuery.value));
function focusSearchResult(id: string) { searchTargetId.value = id; searchFocusToken.value++; }
watch(searchResults, (results) => {
  if (!results.some((result) => result.id === searchTargetId.value)) focusSearchResult(results[0]?.id || '');
});

const insertActionGroups: FlowActionGroup[] = [
  {
    title: '组件操作',
    actions: [
      { type: 'tap', label: '录制点击' },
      { type: 'input', label: '录制输入' },
      { type: 'extractVariable', label: '提取变量' },
      { type: 'clearInput', label: '清空输入' },
      { type: 'coordinateTap', label: '点击坐标' },
      { type: 'longPress', label: '长按' },
      { type: 'checkedState', label: '判断勾选' },
      { type: 'textClick', label: '文字点击' },
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
      { type: 'stopApp', label: '杀死 APP' },
      { type: 'openGallery', label: '启动相册' },
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
      { type: 'waitDisappear', label: '等待元素消失' },
      { type: 'waitActivity', label: '等待 Activity' },
      {
        label: '检测画面变化',
        actions: [
          { type: 'visualChangeStart', label: '开始检测' },
          { type: 'visualChangeEnd', label: '结束检测' },
        ],
      },
    ],
  },
  {
    title: '视觉识别',
    actions: [
      { type: 'aiRecognition', label: 'AI 识别' },
      { type: 'imageCheck', label: '图像判断' },
    ],
  },
  {
    title: '流程控制',
    actions: [
      { type: 'noop', label: '空节点' },
      { type: 'endFlow', label: '终止流程' },
      {
        label: '循环',
        actions: [
          { type: 'loop', label: '有界循环' },
          { type: 'continueLoop', label: '继续下一次循环' },
          { type: 'breakLoop', label: '退出循环' },
        ],
      },
      { type: 'log', label: '输出日志' },
      { type: 'runScript', label: '连接脚本' },
    ],
  },
];

const mainActionGroups = insertActionGroups.map((group) => ({
  ...group,
  actions: group.actions.filter((action) => !('type' in action) || action.type !== 'clearAppData'),
}));
const startActionGroups = insertActionGroups;
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
    ElMessage.warning(deleteMode.value ? 'App 初始化节点不参与批量删除' : 'App 初始化节点不能复制');
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
    const message = error instanceof Error ? error.message : '当前节点不能一起选择';
    ElMessage.warning(deleteMode.value ? message.replace(/复制/g, '删除') : message);
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
  deleteMode.value = false;
  copyMode.value = true;
  selectedCopyIndexes.value = [];
  expandedStepIndex.value = null;
}

function cancelCopyMode() {
  deleteMode.value = false;
  copyMode.value = false;
  selectedCopyIndexes.value = [];
}

function copySelectedNodes() {
  if (!selectedCopyIndexes.value.length) return;
  emit('copy', selectedCopyIndexes.value);
  cancelCopyMode();
}

function startDeleteMode() {
  if (props.mergeDisabled || props.removeDisabled) return;
  startCopyMode();
  deleteMode.value = true;
}

async function deleteSelectedNodes() {
  if (deleting.value || props.mergeDisabled || props.removeDisabled || !selectedCopyIndexes.value.length) return;
  const original = props.steps;
  const next = removeFlowSteps(original, selectedCopyIndexes.value);
  deleting.value = true;
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${original.length - next.length} 个节点？所属分支子节点会一起删除，公共流程保留。`, '批量删除', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', appendTo: 'body',
    });
    if (props.steps !== original || props.mergeDisabled || props.removeDisabled) {
      ElMessage.warning('流程或运行状态已变化，请重新选择');
      return;
    }
    emit('replaceSteps', next);
    cancelCopyMode();
  } catch { /* 取消确认时保留选中状态。 */ }
  finally { deleting.value = false; }
}

watch(() => props.steps, () => { if (copyMode.value) cancelCopyMode(); });

function resetMainFlowPosition() {
  mainResetViewToken.value += 1;
}

watch(flowDialogVisible, (visible) => {
  if (!visible) return;
  void nextTick(() => {
    dialogResetViewToken.value += 1;
  });
});

function canOpenInsertMenu() {
  return !props.disabled || Boolean(props.allowedLockedActions?.length);
}

function isInsertActionDisabled(action: InsertAction) {
  return Boolean(props.disabled && !props.allowedLockedActions?.includes(action));
}

function isStartActionDisabled(action: InsertAction) {
  return (action === 'clearAppData' && hasClearAppDataStep.value)
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
      <FlowNodeSearch v-model:query="searchQuery" :results="searchResults" :selected-id="searchTargetId" @select="focusSearchResult" />
      <template v-if="copyMode">
        <span class="appium-flow-toolbar__status">已选择 {{ selectedCopyIndexes.length }} 个节点</span>
        <el-tooltip :content="deleteMode ? '删除选中' : '复制选中'" placement="top" :show-after="200"><span class="flow-toolbar-icon">
        <el-button :aria-label="deleteMode ? '删除选中' : '复制选中'"
          size="small"
          :type="deleteMode ? 'danger' : 'primary'"
          :loading="deleting"
          :disabled="!selectedCopyIndexes.length || (deleteMode && (mergeDisabled || removeDisabled))"
          :icon="deleteMode ? Delete : CopyDocument"
          @click="deleteMode ? deleteSelectedNodes() : copySelectedNodes()"
        />
        </span></el-tooltip>
        <el-tooltip content="取消" placement="top" :show-after="200"><span class="flow-toolbar-icon"><el-button size="small" :icon="Close" aria-label="取消" @click="cancelCopyMode" /></span></el-tooltip>
      </template>
      <el-tooltip v-else content="批量复制" placement="top" :show-after="200"><span class="flow-toolbar-icon">
      <el-button aria-label="批量复制"
        size="small"
        :icon="CopyDocument"
        :disabled="!steps.length"
        @click="startCopyMode"
      />
      </span></el-tooltip>
      <el-tooltip v-if="!copyMode" content="批量删除" placement="top" :show-after="200"><span class="flow-toolbar-icon">
        <el-button aria-label="批量删除" size="small" :icon="Delete" :disabled="!steps.length || mergeDisabled || removeDisabled" @click="startDeleteMode" />
      </span></el-tooltip>
      <el-tooltip content="还原位置" placement="top" :show-after="200"><span class="flow-toolbar-icon">
      <el-button aria-label="还原位置"
        size="small"
        :icon="Aim"
        @click="resetMainFlowPosition"
      />
      </span></el-tooltip>
      <el-tooltip content="放大" placement="top" :show-after="200"><span class="flow-toolbar-icon">
      <el-button aria-label="放大"
        size="small"
        :icon="FullScreen"
        @click="flowDialogVisible = true"
      />
      </span></el-tooltip>
    </div>

    <FlowCanvas
      id="appium-flow-main"
      :search-target-id="searchTargetId"
      :search-focus-token="searchFocusToken"
      :search-active="!flowDialogVisible"
      :steps="steps"
      :expanded-step-index="expandedStepIndex"
      :copy-mode="copyMode"
      :delete-mode="deleteMode"
      :selected-copy-indexes="selectedCopyIndexes"
      :disabled="disabled"
      :remove-disabled="removeDisabled"
      :merge-disabled="mergeDisabled"
      :launching-step-id="launchingStepId"
      :ai-recognition-model-configured="aiRecognitionModelConfigured"
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
      @paste="(index, branch, beforeStepId) => emit('paste', index, branch, beforeStepId)"
      @remove="(index) => emit('remove', index)"
      @insert-action="(index, action, beforeStepId) => emit('insertAction', index, action, beforeStepId)"
      @insert-branch-action="(index, branch, action) => emit('insertBranchAction', index, branch, action)"
      @edit-input="(index) => emit('editInput', index)"
      @preview-linked-script="(index) => emit('previewLinkedScript', index)"
      @execute-step="(index) => emit('executeStep', index)"
      @update-step="(index, step) => updateStep(index, step)"
      @merge="mergeConditionId = steps[$event]?.id || ''"
    />

    <el-dialog
      v-model="flowDialogVisible"
      title="流程总览"
      @opened="searchTargetId && focusSearchResult(searchTargetId)"
      width="86vw"
      class="appium-flow-dialog"
      align-center
      append-to-body
    >
      <div class="appium-flow-toolbar appium-flow-dialog__toolbar">
        <FlowNodeSearch v-model:query="searchQuery" :results="searchResults" :selected-id="searchTargetId" @select="focusSearchResult" />
        <template v-if="copyMode">
          <span class="appium-flow-toolbar__status">已选择 {{ selectedCopyIndexes.length }} 个节点</span>
          <el-tooltip :content="deleteMode ? '删除选中' : '复制选中'" placement="top" :show-after="200"><span class="flow-toolbar-icon">
          <el-button :aria-label="deleteMode ? '删除选中' : '复制选中'"
            size="small"
            :type="deleteMode ? 'danger' : 'primary'"
            :loading="deleting"
            :disabled="!selectedCopyIndexes.length || (deleteMode && (mergeDisabled || removeDisabled))"
            :icon="deleteMode ? Delete : CopyDocument"
            @click="deleteMode ? deleteSelectedNodes() : copySelectedNodes()"
          />
          </span></el-tooltip>
          <el-tooltip content="取消" placement="top" :show-after="200"><span class="flow-toolbar-icon"><el-button size="small" :icon="Close" aria-label="取消" @click="cancelCopyMode" /></span></el-tooltip>
        </template>
        <el-tooltip v-else content="批量复制" placement="top" :show-after="200"><span class="flow-toolbar-icon">
        <el-button aria-label="批量复制"
          size="small"
          :icon="CopyDocument"
          :disabled="!steps.length"
          @click="startCopyMode"
        />
        </span></el-tooltip>
        <el-tooltip v-if="!copyMode" content="批量删除" placement="top" :show-after="200"><span class="flow-toolbar-icon">
          <el-button aria-label="批量删除" size="small" :icon="Delete" :disabled="!steps.length || mergeDisabled || removeDisabled" @click="startDeleteMode" />
        </span></el-tooltip>
      </div>
      <FlowCanvas
        id="appium-flow-dialog"
        :search-target-id="searchTargetId"
        :search-focus-token="searchFocusToken"
        :search-active="flowDialogVisible"
        class="appium-flow-canvas--dialog"
        :steps="steps"
        :expanded-step-index="expandedStepIndex"
        :copy-mode="copyMode"
        :delete-mode="deleteMode"
        :selected-copy-indexes="selectedCopyIndexes"
        :disabled="disabled"
        :remove-disabled="removeDisabled"
        :merge-disabled="mergeDisabled"
        :launching-step-id="launchingStepId"
        :ai-recognition-model-configured="aiRecognitionModelConfigured"
        :clipboard-count="clipboardCount"
        :reset-view-token="dialogResetViewToken"
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
        @paste="(index, branch, beforeStepId) => emit('paste', index, branch, beforeStepId)"
        @remove="(index) => emit('remove', index)"
        @insert-action="(index, action, beforeStepId) => emit('insertAction', index, action, beforeStepId)"
        @insert-branch-action="(index, branch, action) => emit('insertBranchAction', index, branch, action)"
        @edit-input="(index) => emit('editInput', index)"
        @preview-linked-script="(index) => emit('previewLinkedScript', index)"
        @execute-step="(index) => emit('executeStep', index)"
        @update-step="(index, step) => updateStep(index, step)"
        @merge="mergeConditionId = steps[$event]?.id || ''"
      />
    </el-dialog>
    <MergeBranchesDialog :steps="steps" :condition-id="mergeConditionId" :disabled="mergeDisabled"
      @close="mergeConditionId = ''" @confirm="expandedStepIndex = null; emit('replaceSteps', $event)" />
  </div>
</template>

<style scoped>
.flow-toolbar-icon { display: inline-flex; }
.flow-toolbar-icon .el-button { width: 30px; height: 30px; padding: 0; }
</style>
