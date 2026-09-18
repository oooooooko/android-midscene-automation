<script setup lang="ts">
import { computed } from 'vue';
import type { AppiumRecordedStep, AppiumSelector } from '../types';
import { normalizeVisualChangeConfig } from '../visual-change';
import { longPressMode } from '../long-press';
import { defaultFlowKind, isBooleanCondition } from '../flow-labels';
import TextClickSettings from './TextClickSettings.vue';
import BranchTimeoutSettings from './BranchTimeoutSettings.vue';
import { DEFAULT_NODE_TIMEOUT_MS } from '../node-timeout';
import LongPressSettings from './LongPressSettings.vue';
import StageLogSettings from './StageLogSettings.vue';
import LoopSettings from './LoopSettings.vue';
import BreakLoopSettings from './BreakLoopSettings.vue';
import VariableExtractionSettings from './VariableExtractionSettings.vue';
import ScriptParameterSettings from './ScriptParameterSettings.vue';

type FlowKind = 'action' | 'condition' | 'assertion';
type SwipeGesture = NonNullable<AppiumRecordedStep['swipe']>;
type VisualChangeConfig = NonNullable<AppiumRecordedStep['visualChange']>;

const props = defineProps<{
  step: AppiumRecordedStep;
  steps: AppiumRecordedStep[];
  index: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [payload: { index: number; step: AppiumRecordedStep }];
}>();

const visualChangeConfig = computed(() => normalizeVisualChangeConfig(props.step.visualChange));
const visualChangeRoleLabel = computed(() => (
  visualChangeConfig.value.role === 'start'
    ? `${visualChangeConfig.value.pairLabel || '检测画面变化'} · 开始节点`
    : visualChangeConfig.value.role === 'end'
      ? `${visualChangeConfig.value.pairLabel || '检测画面变化'} · 结束节点`
      : '起止节点截图对比'
));
const visualChangeConfigDisabled = computed(() => Boolean(
  props.disabled || visualChangeConfig.value.role === 'end',
));

function defaultKind(): FlowKind {
  return defaultFlowKind(props.step);
}

function patchStep(patch: Partial<AppiumRecordedStep>) {
  emit('update', {
    index: props.index,
    step: { ...props.step, ...patch, ...('contextSelector' in patch ? { selectorChain: undefined } : {}) },
  });
}

function patchFlow(patch: NonNullable<AppiumRecordedStep['flow']>) {
  patchStep({
    flow: {
      ...(props.step.flow || {}),
      ...patch,
    },
  });
}

function toInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function patchSwipe(patch: Partial<SwipeGesture>) {
  patchStep({
    swipe: {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      duration: 500,
      ...(props.step.swipe || {}),
      ...patch,
    },
  });
}

function patchPinch(patch: Partial<NonNullable<AppiumRecordedStep['pinch']>>) {
  patchStep({ pinch: { direction: 'out', centerX: 0, centerY: 0, percent: 0.5, ...props.step.pinch, ...patch } });
}

function patchTapCoordinate(axis: 'centerX' | 'centerY', value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return;
  const fallback = {
    ...props.step.fallback,
    strategy: 'bounds' as const,
    centerX: props.step.fallback?.centerX ?? 0,
    centerY: props.step.fallback?.centerY ?? 0,
    [axis]: Math.max(0, Math.round(value)),
  };
  // 仅同步自动生成的名称，保留用户自定义的节点名称。
  patchStep({ fallback, ...(/^点击坐标 \d+,\d+$/.test(props.step.label)
    ? { label: `点击坐标 ${fallback.centerX},${fallback.centerY}` } : {}) });
}

function patchVisualChange(patch: Partial<VisualChangeConfig>) {
  patchStep({
    visualChange: normalizeVisualChangeConfig({
      ...normalizeVisualChangeConfig(props.step.visualChange),
      ...patch,
    }),
  });
}

function patchVisualRegion(key: keyof VisualChangeConfig['region'], value: unknown) {
  const current = normalizeVisualChangeConfig(props.step.visualChange);
  patchVisualChange({
    region: {
      ...current.region,
      [key]: Number(value),
    },
  });
}

function patchTimeout(value: unknown) {
  patchStep({ timeoutMs: value == null || value === '' ? undefined : Math.max(0, toInteger(value, DEFAULT_NODE_TIMEOUT_MS)) });
}

const showSelector = computed(() => props.step.type !== 'loop' && props.step.selector && (
  props.step.type !== 'longPress' || longPressMode(props.step) === 'element'
));

function patchSelector(patch: Partial<AppiumSelector>) {
  patchStep({
    selector: { ...props.step.selector!, ...patch },
    // 修改元素目标后，不能继续优先使用录制时的备用 XPath。
    selectorChain: undefined,
  });
}
</script>

<template>
  <div class="appium-flow-editor">
    <el-form label-position="top" size="small">
      <el-form-item label="节点名称">
        <el-input
          :model-value="step.label"
          :disabled="disabled"
          @update:model-value="patchStep({ label: String($event) })"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          :model-value="step.note || ''"
          :disabled="disabled"
          maxlength="100"
          placeholder="例如：登录按钮、账号输入框"
          @update:model-value="patchStep({ note: String($event) || undefined })"
        />
      </el-form-item>
      <div>
        <el-form-item v-if="!['longPress', 'stopApp', 'log', 'openGallery', 'endFlow', 'loop', 'breakLoop'].includes(step.type)" label="超时时间 ms">
          <el-input-number
            :model-value="step.timeoutMs ?? (step.type === 'delay' ? 1000 : DEFAULT_NODE_TIMEOUT_MS)"
            :disabled="disabled"
            :min="0"
            :max="999999"
            controls-position="right"
            @update:model-value="patchTimeout($event)"
          />
        </el-form-item>
        <BranchTimeoutSettings v-if="defaultKind() === 'condition'" :step="step" :disabled="disabled" @update="patchStep({ timeoutBranch: $event })" />
      </div>
      <LongPressSettings v-if="step.type === 'longPress'" :step="step" :disabled="disabled" @update="patchStep" />
      <el-form-item v-if="['waitActivity', 'launchApp', 'stopApp', 'clearAppData'].includes(step.type)" :label="step.type === 'waitActivity' ? '目标 Activity' : '目标 APP 包名'">
        <el-input :model-value="step.value || ''" :disabled="disabled" @update:model-value="patchStep({ value: String($event) })" />
      </el-form-item>
      <template v-if="step.type === 'pinch'">
        <el-form-item label="缩放方向">
          <el-select :model-value="step.pinch?.direction || 'out'" :disabled="disabled" @update:model-value="patchPinch({ direction: $event })">
            <el-option label="放大" value="out" /><el-option label="缩小" value="in" />
          </el-select>
        </el-form-item>
        <el-form-item v-for="axis in (['centerX', 'centerY'] as const)" :key="axis" :label="axis === 'centerX' ? '中心 X' : '中心 Y'">
          <el-input-number :model-value="step.pinch?.[axis] ?? 0" :disabled="disabled" :min="0" :max="99999" :precision="0" controls-position="right" @update:model-value="patchPinch({ [axis]: $event ?? 0 })" />
        </el-form-item>
        <el-form-item label="缩放比例">
          <el-input-number :model-value="step.pinch?.percent ?? 0.5" :disabled="disabled" :min="0.01" :max="1" :step="0.05" controls-position="right" @update:model-value="patchPinch({ percent: $event ?? 0.5 })" />
        </el-form-item>
      </template>
      <div v-if="step.type === 'coordinateTap'" class="appium-flow-editor__grid">
        <el-form-item label="坐标 X">
          <el-input-number :model-value="step.fallback?.centerX ?? 0" :disabled="disabled" :min="0" :max="99999" :precision="0" controls-position="right" aria-label="坐标 X" @update:model-value="patchTapCoordinate('centerX', $event)" />
        </el-form-item>
        <el-form-item label="坐标 Y">
          <el-input-number :model-value="step.fallback?.centerY ?? 0" :disabled="disabled" :min="0" :max="99999" :precision="0" controls-position="right" aria-label="坐标 Y" @update:model-value="patchTapCoordinate('centerY', $event)" />
        </el-form-item>
      </div>
      <StageLogSettings v-if="step.type === 'log'" :step="step" :disabled="disabled" @update="patchStep" />
      <VariableExtractionSettings v-if="step.type === 'extractVariable'" :step="step" :disabled="disabled" @update="patchStep" />
      <ScriptParameterSettings v-if="step.type === 'runScript'" :step="step" :disabled="disabled" @update="patchStep" />
      <LoopSettings v-if="step.type === 'loop'" :step="step" :disabled="disabled" @update="patchStep" />
      <BreakLoopSettings v-if="step.type === 'breakLoop'" :step="step" :steps="steps" :disabled="disabled" @update="patchStep" />
      <TextClickSettings v-if="step.type === 'textClick'" :step="step" :disabled="disabled" @update="patchStep" />
      <el-form-item
        v-if="step.type === 'input' || step.type === 'inputIfExists' || step.type === 'assertText'"
        label="文本内容"
      >
        <el-input
          :model-value="step.value || ''"
          :disabled="disabled"
          @update:model-value="patchStep({ value: String($event) })"
        />
      </el-form-item>
      <template v-if="step.type === 'visualChange'">
        <div class="appium-flow-editor__grid">
          <el-form-item label="检测标记">
            <el-input :model-value="visualChangeRoleLabel" disabled />
          </el-form-item>
          <el-form-item label="检测目标">
            <el-select
              :model-value="visualChangeConfig.mode"
              :disabled="visualChangeConfigDisabled"
              @update:model-value="patchVisualChange({ mode: $event as VisualChangeConfig['mode'] })"
            >
              <el-option label="当前选中元素" value="selectedElement" />
              <el-option label="手动区域" value="region" />
            </el-select>
          </el-form-item>
          <el-form-item label="变化阈值 %">
            <el-input-number
              :model-value="visualChangeConfig.changeRatioThreshold"
              :disabled="disabled"
              :min="0.01"
              :max="100"
              :step="0.1"
              controls-position="right"
              @update:model-value="patchVisualChange({ changeRatioThreshold: Number($event) })"
            />
          </el-form-item>
        </div>
        <div class="appium-flow-editor__grid appium-flow-editor__grid--visual">
          <el-form-item label="X">
            <el-input-number
              :model-value="visualChangeConfig.region.x"
              :disabled="visualChangeConfigDisabled"
              :min="0"
              :max="99999"
              :precision="0"
              controls-position="right"
              @update:model-value="patchVisualRegion('x', $event)"
            />
          </el-form-item>
          <el-form-item label="Y">
            <el-input-number
              :model-value="visualChangeConfig.region.y"
              :disabled="visualChangeConfigDisabled"
              :min="0"
              :max="99999"
              :precision="0"
              controls-position="right"
              @update:model-value="patchVisualRegion('y', $event)"
            />
          </el-form-item>
          <el-form-item label="宽度">
            <el-input-number
              :model-value="visualChangeConfig.region.width"
              :disabled="visualChangeConfigDisabled"
              :min="1"
              :max="99999"
              :precision="0"
              controls-position="right"
              @update:model-value="patchVisualRegion('width', $event)"
            />
          </el-form-item>
          <el-form-item label="高度">
            <el-input-number
              :model-value="visualChangeConfig.region.height"
              :disabled="visualChangeConfigDisabled"
              :min="1"
              :max="99999"
              :precision="0"
              controls-position="right"
              @update:model-value="patchVisualRegion('height', $event)"
            />
          </el-form-item>
          <el-form-item label="像素容差">
            <el-input-number
              :model-value="visualChangeConfig.pixelmatchThreshold"
              :disabled="visualChangeConfigDisabled"
              :min="0"
              :max="1"
              :step="0.01"
              controls-position="right"
              @update:model-value="patchVisualChange({ pixelmatchThreshold: Number($event) })"
            />
          </el-form-item>
        </div>
      </template>
      <div v-if="step.type === 'swipe'" class="appium-flow-editor__grid appium-flow-editor__grid--swipe">
        <el-form-item label="起点 X">
          <el-input-number
            :model-value="step.swipe?.startX ?? 0"
            :disabled="disabled"
            :min="0"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchSwipe({ startX: toInteger($event, step.swipe?.startX ?? 0) })"
          />
        </el-form-item>
        <el-form-item label="起点 Y">
          <el-input-number
            :model-value="step.swipe?.startY ?? 0"
            :disabled="disabled"
            :min="0"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchSwipe({ startY: toInteger($event, step.swipe?.startY ?? 0) })"
          />
        </el-form-item>
        <el-form-item label="终点 X">
          <el-input-number
            :model-value="step.swipe?.endX ?? 0"
            :disabled="disabled"
            :min="0"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchSwipe({ endX: toInteger($event, step.swipe?.endX ?? 0) })"
          />
        </el-form-item>
        <el-form-item label="终点 Y">
          <el-input-number
            :model-value="step.swipe?.endY ?? 0"
            :disabled="disabled"
            :min="0"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchSwipe({ endY: toInteger($event, step.swipe?.endY ?? 0) })"
          />
        </el-form-item>
        <el-form-item label="时长 ms">
          <el-input-number
            :model-value="step.swipe?.duration ?? 500"
            :disabled="disabled"
            :min="80"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchSwipe({ duration: Math.max(80, toInteger($event, step.swipe?.duration ?? 500)) })"
          />
        </el-form-item>
      </div>
      <div v-if="showSelector && step.selector" class="appium-flow-editor__grid">
        <el-form-item label="Selector 类型">
          <el-select
            :model-value="step.selector.strategy"
            :disabled="disabled"
            @update:model-value="patchSelector({ strategy: $event as AppiumSelector['strategy'] })"
          >
            <el-option label="accessibility id" value="accessibilityId" />
            <el-option label="id" value="id" />
            <el-option label="android uiAutomator" value="androidUiAutomator" />
            <el-option label="xpath" value="xpath" />
          </el-select>
        </el-form-item>
        <el-form-item label="Selector 值">
          <el-input
            :model-value="step.selector.value || ''"
            :disabled="disabled"
            @update:model-value="patchSelector({ value: String($event) })"
          />
        </el-form-item>
      </div>
      <div v-if="showSelector" class="appium-flow-editor__grid">
        <el-form-item label="父级上下文类型">
          <el-select
            :model-value="step.contextSelector?.strategy || ''"
            :disabled="disabled"
            clearable
            placeholder="不使用父级"
            @update:model-value="patchStep({ contextSelector: $event ? { ...(step.contextSelector || { value: '' }), strategy: $event as AppiumSelector['strategy'] } : undefined })"
          >
            <el-option label="accessibility id" value="accessibilityId" />
            <el-option label="id" value="id" />
            <el-option label="android uiAutomator" value="androidUiAutomator" />
            <el-option label="xpath" value="xpath" />
          </el-select>
        </el-form-item>
        <el-form-item label="父级上下文值">
          <el-input
            :model-value="step.contextSelector?.value || ''"
            :disabled="disabled || !step.contextSelector"
            @update:model-value="patchStep({ contextSelector: { ...(step.contextSelector || { strategy: 'xpath' }), value: String($event) } })"
          />
        </el-form-item>
      </div>
      <div v-if="defaultKind() === 'condition' && step.type !== 'loop' && !isBooleanCondition(step)" class="appium-flow-editor__grid">
        <el-form-item label="指定文本（可选）">
          <el-input
            :model-value="step.value || ''"
            :disabled="disabled"
            clearable
            placeholder="不填写时仅判断组件是否存在"
            @update:model-value="patchStep({ value: String($event) })"
          />
        </el-form-item>
        <el-form-item label="文本匹配方式">
          <el-select
            :model-value="step.flow?.textMatch || 'contains'"
            :disabled="disabled || !step.value"
            @update:model-value="patchFlow({ textMatch: $event as 'contains' | 'exact' })"
          >
            <el-option label="模糊匹配（包含）" value="contains" />
            <el-option label="精准匹配（完全一致）" value="exact" />
          </el-select>
        </el-form-item>
      </div>
    </el-form>
  </div>
</template>
