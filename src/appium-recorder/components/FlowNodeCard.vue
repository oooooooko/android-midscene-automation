<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { CopyDocument, Delete, Edit, Plus, VideoPlay, View } from '@element-plus/icons-vue';
import type { AppiumRecordedStep } from '../types';
import {
  PASTE_COMMAND,
  type FlowBranch,
  type FlowGraphNodeData,
  type InsertAction,
} from '../flow-graph';
import FlowStepEditor from './FlowStepEditor.vue';

const props = defineProps<{
  nodeId: string;
  data: FlowGraphNodeData;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  nodeClick: [index: number];
  copy: [index: number];
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

const branchLabel = computed(() => {
  if (props.data.kind !== 'branch') return '';
  return props.data.branch === 'yes' ? '是' : '否';
});

const insertTitle = computed(() => {
  if (props.data.kind !== 'insert') return '';
  if (props.data.branch === 'yes') return '在“是”分支插入操作';
  if (props.data.branch === 'no') return '在“否”分支插入操作';
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
      tabindex="-1"
    >
      {{ branchLabel }}
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
        <el-dropdown
          trigger="click"
          :disabled="!data.canOpenInsertMenu"
          max-height="320px"
          popper-class="appium-action-dropdown"
          @command="emitInsert"
        >
          <el-button
            circle
            type="primary"
            :icon="Plus"
            :disabled="!data.canOpenInsertMenu"
            :aria-label="insertTitle"
          />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-if="data.clipboardCount"
                :command="PASTE_COMMAND"
                divided
              >
                粘贴 {{ data.clipboardCount }} 个节点
              </el-dropdown-item>
              <template v-for="group in data.actionGroups" :key="group.title">
                <div class="appium-action-dropdown__group">{{ group.title }}</div>
                <el-dropdown-item
                  v-for="action in group.actions"
                  :key="action.type"
                  :command="action.type"
                  :disabled="data.isActionDisabled(action.type)"
                >
                  {{ action.label }}
                </el-dropdown-item>
              </template>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
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
          <strong :title="data.title">{{ data.title }}</strong>
          <small :title="data.meta">{{ data.meta }}</small>
          <em v-if="data.note" :title="data.note">{{ data.note }}</em>
        </span>
      </button>
      <span v-if="!props.readonly" class="appium-flow-step-card__actions nodrag nopan" @click.stop>
        <el-button
          v-if="!data.copyMode && data.canCopy"
          text
          size="small"
          :icon="CopyDocument"
          title="复制节点"
          @click="emit('copy', data.index)"
        />
        <el-button
          v-if="data.canExecute"
          text
          size="small"
          :icon="VideoPlay"
          :loading="data.launching"
          :disabled="data.disabled"
          title="立即执行"
          @click="emit('execute', data.index)"
        />
        <el-button
          v-if="data.canEditInput"
          text
          size="small"
          :icon="Edit"
          :disabled="data.disabled"
          title="修改输入内容"
          @click="emit('editInput', data.index)"
        />
        <el-button
          v-if="data.step.type === 'runScript'"
          text
          size="small"
          :icon="View"
          title="预览连接脚本"
          @click="emit('previewLinkedScript', data.index)"
        />
        <el-button
          text
          size="small"
          :icon="Delete"
          :disabled="data.removeDisabled"
          title="删除节点"
          @click="emit('remove', data.index)"
        />
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
