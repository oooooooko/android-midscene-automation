<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { CopyDocument, Delete, Edit, Plus, VideoPlay, View, WarningFilled, Connection } from '@element-plus/icons-vue';
import { AI_MODEL_CONFIG_HINT } from '../ai-recognition';
import type { AppiumRecordedStep } from '../types';
import {
  PASTE_COMMAND,
  type FlowBranch,
  type FlowGraphNodeData,
  type InsertAction,
} from '../flow-graph';
import FlowStepEditor from './FlowStepEditor.vue';
import FlowActionMenu from './FlowActionMenu.vue';

const props = defineProps<{
  nodeId: string;
  data: FlowGraphNodeData;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  nodeClick: [index: number];
  copy: [index: number];
  merge: [index: number];
  remove: [index: number];
  editInput: [index: number];
  previewLinkedScript: [index: number];
  execute: [index: number];
  insert: [payload: { afterIndex: number; action: InsertAction | typeof PASTE_COMMAND; branch?: FlowBranch; conditionIndex?: number }];
  updateStep: [payload: { index: number; step: AppiumRecordedStep }];
  resize: [payload: { id: string; height: number }];
}>();

const rootRef = shallowRef<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

const insertTitle = computed(() => {
  if (props.data.kind !== 'insert') return '';
  if (props.data.branch) return `在“${props.data.branchLabel || (props.data.branch === 'yes' ? '是' : '否')}”分支插入操作`;
  return props.data.afterIndex < 0 ? '在开始后插入操作' : '插入操作';
});

function emitInsert(command: string | number | object) {
  if (props.readonly || props.data.kind !== 'insert') return;
  emit('insert', {
    afterIndex: props.data.afterIndex,
    action: command === PASTE_COMMAND ? PASTE_COMMAND : command as InsertAction,
    branch: props.data.branch,
    conditionIndex: props.data.conditionIndex,
  });
}

function updateStep(payload: { index: number; step: AppiumRecordedStep }) {
  if (props.readonly) return;
  emit('updateStep', payload);
}

function handleStepClick() {
  if (props.readonly || props.data.kind !== 'step') return;
  emit('nodeClick', props.data.index);
}

function reportSize() {
  if (!rootRef.value || props.data.kind !== 'step') return;
  emit('resize', {
    id: props.nodeId,
    height: rootRef.value.offsetHeight,
  });
}

onMounted(() => {
  resizeObserver = new ResizeObserver(reportSize);
  if (rootRef.value) resizeObserver.observe(rootRef.value);
  void nextTick(reportSize);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

watch(() => props.data, () => {
  void nextTick(reportSize);
});
</script>

<template>
  <div
    ref="rootRef"
    class="appium-flow-graph-node nodrag nopan"
    :class="`appium-flow-graph-node--${data.kind}`"
    :style="data.kind === 'branch' ? { width: `${data.width}px` } : undefined"
    @pointerdown.stop
    @mousedown.stop
    @touchstart.stop
  >
    <Handle
      id="top"
      type="target"
      :position="Position.Top"
      class="appium-flow-handle appium-flow-handle--top"
    />

    <div v-if="data.kind === 'start'" class="appium-flow-start-card nodrag nopan">
      <span class="appium-flow-start-card__icon">S</span>
      <span>
        <strong>开始</strong>
        <small>当前脚本入口</small>
      </span>
    </div>

    <button
      v-else-if="data.kind === 'branch'"
      type="button"
      class="appium-flow-branch-pill nodrag nopan"
      :class="`appium-flow-branch-pill--${data.branch}`"
      style="width: 100%"
      tabindex="-1"
    >
      {{ data.label }}
    </button>

    <span
      v-else-if="data.kind === 'split'"
      class="appium-flow-split-joint"
      aria-hidden="true"
    />

    <div v-else-if="data.kind === 'insert'" class="appium-flow-insert-node nodrag nopan">
      <span
        v-if="props.readonly"
        class="appium-flow-insert-preview-point"
        aria-hidden="true"
      />
      <el-tooltip v-else content="添加操作" placement="top">
        <FlowActionMenu
          :groups="data.actionGroups"
          :disabled="!data.canOpenInsertMenu"
          :clipboard-count="data.clipboardCount"
          :is-action-disabled="data.isActionDisabled"
          @command="emitInsert"
        >
          <el-button
            circle
            type="primary"
            :icon="Plus"
            :disabled="!data.canOpenInsertMenu"
            :aria-label="insertTitle"
          />
        </FlowActionMenu>
      </el-tooltip>
    </div>

    <div
      v-else
      class="appium-flow-step-shell"
      :class="[
        `appium-flow-step-shell--${data.flowKind}`,
        {
          'appium-flow-step-shell--expanded': data.expanded,
          'appium-flow-step-shell--selected': data.selected,
          'appium-flow-step-shell--copying': data.copyMode,
          'appium-flow-step-shell--readonly': props.readonly,
        },
      ]"
    >
      <button
        type="button"
        class="appium-flow-step-card nodrag nopan"
        :style="{ minHeight: `${data.cardMinHeight}px` }"
        @click="handleStepClick"
      >
        <span class="appium-flow-step-card__content">
          <el-tooltip v-if="data.missingAiModel" :content="AI_MODEL_CONFIG_HINT" placement="top">
            <el-icon class="appium-ai-model-warning" color="var(--el-color-danger)" role="img" aria-label="AI 识别模型未配置" tabindex="0">
              <WarningFilled />
            </el-icon>
          </el-tooltip>
          <strong :title="data.title">{{ data.title }}</strong>
          <small :title="data.meta">{{ data.meta }}</small>
          <em v-if="data.note" :title="data.note">{{ data.note }}</em>
        </span>
      </button>
      <span v-if="!props.readonly" class="appium-flow-step-card__actions nodrag nopan" @click.stop>
        <el-tooltip v-if="data.flowKind === 'condition' && !data.copyMode" content="合并分支：将两侧后续节点汇入公共流程" placement="top" :show-after="200">
        <span class="appium-node-action-tooltip"><el-button text size="small" :icon="Connection"
          title="合并分支" aria-label="合并分支" :disabled="data.mergeDisabled || Boolean(data.step.flow?.successTargetId)"
          @click="emit('merge', data.index)" />
        </span></el-tooltip>
        <el-tooltip v-if="!data.copyMode && data.canCopy" content="复制节点：复制后可在插入位置粘贴" placement="top" :show-after="200">
        <span class="appium-node-action-tooltip">
        <el-button
          text
          size="small"
          :icon="CopyDocument"
          title="复制节点"
          @click="emit('copy', data.index)"
        />
        </span></el-tooltip>
        <el-tooltip v-if="data.canExecute" :content="data.step.type === 'aiRecognition' ? '测试 AI 识别：使用当前设备画面测试识别结果' : '立即执行：在当前设备上执行此操作'" placement="top" :show-after="200">
        <span class="appium-node-action-tooltip">
        <el-button
          text
          size="small"
          :icon="VideoPlay"
          :loading="data.launching"
          :disabled="data.disabled"
          :title="data.step.type === 'aiRecognition' ? '测试 AI 识别' : '立即执行'"
          :aria-label="data.step.type === 'aiRecognition' ? '测试 AI 识别' : '立即执行'"
          @click="emit('execute', data.index)"
        />
        </span></el-tooltip>
        <el-tooltip v-if="data.canEditInput" content="修改输入内容：编辑此节点要输入的文字" placement="top" :show-after="200">
        <span class="appium-node-action-tooltip">
        <el-button
          text
          size="small"
          :icon="Edit"
          :disabled="data.disabled"
          title="修改输入内容"
          @click="emit('editInput', data.index)"
        />
        </span></el-tooltip>
        <el-tooltip v-if="data.step.type === 'runScript'" content="预览连接脚本：查看关联脚本的流程" placement="top" :show-after="200">
        <span class="appium-node-action-tooltip">
        <el-button
          text
          size="small"
          :icon="View"
          title="预览连接脚本"
          @click="emit('previewLinkedScript', data.index)"
        />
        </span></el-tooltip>
        <el-tooltip :content="data.flowKind === 'condition' ? '删除节点：同时删除所属分支子节点，保留公共流程' : '删除节点：移除此操作并连接前后节点'" placement="top" :show-after="200">
        <span class="appium-node-action-tooltip">
        <el-button
          text
          size="small"
          :icon="Delete"
          :disabled="data.removeDisabled"
          title="删除节点"
          @click="emit('remove', data.index)"
        />
        </span></el-tooltip>
      </span>
      <FlowStepEditor
        v-if="!props.readonly && data.expanded"
        class="appium-flow-step-editor nodrag nopan"
        :step="data.step"
        :index="data.index"
        :disabled="data.disabled"
        @update="updateStep"
      />
    </div>

    <Handle
      id="bottom"
      type="source"
      :position="Position.Bottom"
      class="appium-flow-handle appium-flow-handle--bottom"
    />
  </div>
</template>

<style scoped>
.appium-node-action-tooltip { display: inline-flex; }
.appium-ai-model-warning { float: left; margin: 2px 6px 0 0; font-size: 16px; }
</style>
