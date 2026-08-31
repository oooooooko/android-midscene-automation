<script setup lang="ts">
import { computed } from 'vue';
import { CopyDocument, Delete, Edit, Timer } from '@element-plus/icons-vue';
import type { AppiumRecordedStep } from '../types';
import { buildConditionLayouts, FLOW_BRANCH_GAP, FLOW_NODE_WIDTH } from '../flow-layout';
import FlowStepEditor from './FlowStepEditor.vue';

type BranchName = 'yes' | 'no';
type FlowKind = 'action' | 'condition' | 'assertion';
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

const PASTE_COMMAND = '__paste_flow_nodes__';

const props = defineProps<{
  steps: AppiumRecordedStep[];
  condition: AppiumRecordedStep;
  conditionIndex: number;
  expandedStepIndex: number | null;
  copyMode?: boolean;
  selectedCopyIndexes?: number[];
  disabled?: boolean;
  removeDisabled?: boolean;
  allowedLockedActions?: InsertAction[];
  clipboardCount?: number;
}>();

const emit = defineEmits<{
  nodeClick: [index: number];
  copy: [indexes: number[]];
  remove: [index: number];
  paste: [index: number, branch: BranchName];
  insertBranchAction: [index: number, branch: BranchName, action: InsertAction];
  editInput: [index: number];
  updateStep: [index: number, step: AppiumRecordedStep];
}>();

const stepItems = computed(() => props.steps.map((step, index) => ({ step, index })));
const layout = computed(() => buildConditionLayouts(props.steps).get(props.condition.id) || {
  yesWidth: FLOW_NODE_WIDTH,
  noWidth: FLOW_NODE_WIDTH,
  totalWidth: FLOW_NODE_WIDTH * 2 + FLOW_BRANCH_GAP,
  yesAxis: 25,
  noAxis: 75,
});
const actionGroups: Array<{ title: string; actions: Array<{ type: InsertAction; label: string }> }> = [
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
  { title: '流程控制', actions: [{ type: 'runScript', label: '连接脚本' }] },
];

function defaultKind(step: AppiumRecordedStep): FlowKind {
  if (step.flow?.nodeKind) return step.flow.nodeKind;
  if (step.type === 'assertExists' || step.type === 'assertText') return 'assertion';
  return 'action';
}

function kindLabel(kind: FlowKind) {
  return { action: '操作', condition: '判断', assertion: '校验' }[kind];
}

function typeLabel(step: AppiumRecordedStep) {
  const labels: Partial<Record<AppiumRecordedStep['type'], string>> = {
    tap: '点击', input: '输入', tapIfExists: '存在则点击', inputIfExists: '存在则输入',
    clearIfExists: '存在则清空', backIfExists: '存在则返回', clearInput: '清空',
    waitFor: '等待出现', waitDisappear: '等待消失', assertExists: '断言存在',
    assertText: '断言文本', key: '按键', waitActivity: '等待 Activity', delay: '延时',
    coordinateTap: '坐标点击', swipe: '滑动', launchApp: '启动 APP', clearAppData: '清理 APP 缓存', longPress: '长按',
    pinch: '双指缩放', runScript: '连接脚本', screenshot: '截图',
  };
  return labels[step.type] || step.type;
}

function stepMeta(step: AppiumRecordedStep) {
  if (step.type === 'delay') return `${step.timeoutMs || 1000}ms`;
  if (step.type === 'input' || step.type === 'inputIfExists') return `输入内容：${step.value || '空'}`;
  if (step.type === 'longPress') return `${step.fallback?.centerX || ''},${step.fallback?.centerY || ''} · ${step.timeoutMs || 800}ms`;
  if (step.type === 'coordinateTap') return `${step.fallback?.centerX || ''},${step.fallback?.centerY || ''}`;
  if (step.type === 'swipe') {
    const swipe = step.swipe;
    return swipe ? `[${swipe.startX},${swipe.startY}] -> [${swipe.endX},${swipe.endY}]` : '';
  }
  if (defaultKind(step) === 'condition' && step.value) {
    return `${step.flow?.textMatch === 'exact' ? '精准匹配' : '模糊匹配'}：${step.value}`;
  }
  if (step.contextSelector && step.selector) {
    return `父级 ${step.contextSelector.strategy} ${step.contextSelector.value || ''} + 子级 ${step.selector.strategy} ${step.selector.value || ''}`;
  }
  if (step.type === 'key') return `keyCode ${step.keyCode || ''}`;
  if (step.type === 'runScript') return step.value ? `脚本 ${step.value}` : '';
  return `${step.selector?.strategy || ''} ${step.selector?.value || ''}`.trim();
}

function branchItems(branch: BranchName) {
  return stepItems.value.filter(({ step }) => (
    step.flow?.parentConditionId === props.condition.id && step.flow.parentBranch === branch
  ));
}

function branchConnectionTargetId(branch: BranchName) {
  const items = branchItems(branch);
  if (items.length) {
    const lastItem = items[items.length - 1];
    return defaultKind(lastItem.step) === 'condition'
      ? ''
      : lastItem.step.flow?.successTargetId || '';
  }
  const targetId = branch === 'yes' ? props.condition.flow?.yesTargetId : props.condition.flow?.noTargetId;
  const target = props.steps.find((step) => step.id === targetId);
  return target && !target.flow?.parentConditionId ? target.id : '';
}

function targetLabel(branch: BranchName) {
  const id = branch === 'yes' ? props.condition.flow?.yesTargetId : props.condition.flow?.noTargetId;
  if (!id) return '结束';
  const index = props.steps.findIndex((step) => step.id === id);
  return index < 0 ? '未找到目标' : props.steps[index].label;
}

function isDescendant(descendantIndex: number, ancestorIndex: number) {
  const ancestorId = props.steps[ancestorIndex]?.id;
  let parentId = props.steps[descendantIndex]?.flow?.parentConditionId;
  while (ancestorId && parentId) {
    if (parentId === ancestorId) return true;
    parentId = props.steps.find((step) => step.id === parentId)?.flow?.parentConditionId;
  }
  return false;
}

function isSelected(index: number) {
  return Boolean(props.selectedCopyIndexes?.includes(index)
    || props.selectedCopyIndexes?.some((selectedIndex) => isDescendant(index, selectedIndex)));
}

function canOpenInsertMenu() {
  return !props.disabled || Boolean(props.allowedLockedActions?.length);
}

function isActionDisabled(action: InsertAction) {
  return Boolean(props.disabled && !props.allowedLockedActions?.includes(action));
}

function insert(branch: BranchName, command: string | number | object) {
  if (command === PASTE_COMMAND) emit('paste', props.conditionIndex, branch);
  else emit('insertBranchAction', props.conditionIndex, branch, command as InsertAction);
}

function updateStep(payload: { index: number; step: AppiumRecordedStep }) {
  emit('updateStep', payload.index, payload.step);
}

function branchSplitPath() {
  const yesMiddle = (50 + layout.value.yesAxis) / 2;
  const noMiddle = (50 + layout.value.noAxis) / 2;
  return [
    `M${layout.value.yesAxis} 48 L${layout.value.yesAxis} 31`,
    `C${layout.value.yesAxis} 16 ${yesMiddle} 0 50 0`,
    `C${noMiddle} 0 ${layout.value.noAxis} 16 ${layout.value.noAxis} 31`,
    `L${layout.value.noAxis} 48`,
  ].join(' ');
}
</script>

<template>
  <div class="appium-flow-nested-condition" :style="{ width: `${layout.totalWidth}px`, minWidth: `${layout.totalWidth}px` }">
    <div
      class="appium-flow-branches"
      :style="{
        width: `${layout.totalWidth}px`,
        minWidth: `${layout.totalWidth}px`,
        gridTemplateColumns: `${layout.yesWidth}px ${layout.noWidth}px`,
      }"
    >
      <svg class="appium-flow-branch-lines" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
        <path :d="branchSplitPath()" />
      </svg>
      <div
        v-for="branch in (['yes', 'no'] as const)"
        :key="branch"
        class="appium-flow-branch"
        :data-flow-condition-id="condition.id"
        :data-flow-branch="branch"
        :class="[`appium-flow-branch--${branch}`, { 'appium-flow-branch--connected': branchConnectionTargetId(branch) }]"
      >
        <svg class="appium-flow-line appium-flow-branch__line" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M5 0 V100" />
        </svg>
        <strong class="appium-flow-branch__label">{{ branch === 'yes' ? '是' : '否' }}</strong>
        <div v-if="branchItems(branch).length" class="appium-flow-branch-steps">
          <div v-for="item in branchItems(branch)" :key="item.step.id" class="appium-flow-branch-step-group">
            <div
              class="appium-flow-node appium-flow-branch-step"
              :class="[
                `appium-flow-node--${defaultKind(item.step)}`,
                {
                  'appium-flow-node--expanded': expandedStepIndex === item.index,
                  'appium-flow-node--selected': isSelected(item.index),
                  'appium-flow-node--copying': copyMode,
                },
              ]"
            >
              <button
                type="button"
                class="appium-flow-node__toggle"
                :aria-expanded="expandedStepIndex === item.index"
                @click.stop="$emit('nodeClick', item.index)"
              >
                <span class="appium-flow-node__body">
                  <span class="appium-flow-node__title">{{ item.step.label }}</span>
                  <span class="appium-flow-node__meta">
                    {{ kindLabel(defaultKind(item.step)) }} · {{ typeLabel(item.step) }}
                    <template v-if="stepMeta(item.step)"> · {{ stepMeta(item.step) }}</template>
                  </span>
                  <span v-if="item.step.note" class="appium-flow-node__note">{{ item.step.note }}</span>
                </span>
              </button>
              <span class="appium-flow-node__actions" @click.stop>
                <el-button
                  v-if="!copyMode"
                  text
                  size="small"
                  :icon="CopyDocument"
                  title="复制节点"
                  @click="$emit('copy', [item.index])"
                />
                <el-button
                  v-if="item.step.type === 'input' || item.step.type === 'inputIfExists'"
                  text
                  size="small"
                  :icon="Edit"
                  :disabled="disabled"
                  title="修改输入内容"
                  @click="$emit('editInput', item.index)"
                />
                <el-button
                  text
                  size="small"
                  :icon="Delete"
                  :disabled="removeDisabled"
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
              :remove-disabled="removeDisabled"
              :allowed-locked-actions="allowedLockedActions"
              :clipboard-count="clipboardCount"
              @node-click="$emit('nodeClick', $event)"
              @copy="$emit('copy', $event)"
              @remove="$emit('remove', $event)"
              @paste="(index, childBranch) => $emit('paste', index, childBranch)"
              @insert-branch-action="(index, childBranch, action) => $emit('insertBranchAction', index, childBranch, action)"
              @edit-input="$emit('editInput', $event)"
              @update-step="(index, step) => $emit('updateStep', index, step)"
            />
          </div>
        </div>
        <span v-else class="appium-flow-branch__target">{{ targetLabel(branch) }}</span>
        <div class="appium-flow-branch__actions">
          <el-dropdown
            trigger="click"
            :disabled="!canOpenInsertMenu()"
            max-height="320px"
            popper-class="appium-action-dropdown"
            @command="insert(branch, $event)"
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
                <template v-for="group in actionGroups" :key="group.title">
                  <div class="appium-action-dropdown__group">{{ group.title }}</div>
                  <el-dropdown-item
                    v-for="action in group.actions"
                    :key="action.type"
                    :command="action.type"
                    :disabled="isActionDisabled(action.type)"
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
  </div>
</template>
