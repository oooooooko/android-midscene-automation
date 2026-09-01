<script setup lang="ts">
import { computed } from 'vue';
import type { AppiumRecordedStep, AppiumSelector } from '../types';
import { normalizeVisualChangeConfig } from '../visual-change';

type FlowKind = 'action' | 'condition' | 'assertion';
type SwipeGesture = NonNullable<AppiumRecordedStep['swipe']>;
type VisualChangeConfig = NonNullable<AppiumRecordedStep['visualChange']>;

const props = defineProps<{
  step: AppiumRecordedStep;
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
  if (props.step.flow?.nodeKind) return props.step.flow.nodeKind;
  if (props.step.type === 'assertExists' || props.step.type === 'assertText' || props.step.type === 'visualChange') return 'assertion';
  return 'action';
}

function patchStep(patch: Partial<AppiumRecordedStep>) {
  emit('update', {
    index: props.index,
    step: { ...props.step, ...patch },
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

function timeoutLabel() {
  return props.step.type === 'longPress' ? '长按时间 ms' : '超时时间 ms';
}

function timeoutMin() {
  return props.step.type === 'longPress' ? 80 : 0;
}

function patchTimeout(value: unknown) {
  const timeout = Math.max(timeoutMin(), toInteger(value, props.step.timeoutMs || 0));
  patchStep({ timeoutMs: timeout || undefined });
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
      <div class="appium-flow-editor__grid">
        <el-form-item label="节点类型">
          <el-select
            :model-value="defaultKind()"
            :disabled="disabled"
            @update:model-value="patchFlow({ nodeKind: $event as FlowKind })"
          >
            <el-option label="操作" value="action" />
            <el-option label="判断" value="condition" />
            <el-option label="校验" value="assertion" />
          </el-select>
        </el-form-item>
        <el-form-item :label="timeoutLabel()">
          <el-input-number
            :model-value="step.timeoutMs || undefined"
            :disabled="disabled"
            :min="timeoutMin()"
            :max="999999"
            controls-position="right"
            @update:model-value="patchTimeout($event)"
          />
        </el-form-item>
      </div>
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
              :disabled="visualChangeConfigDisabled"
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
      <div v-if="step.selector" class="appium-flow-editor__grid">
        <el-form-item label="Selector 类型">
          <el-select
            :model-value="step.selector.strategy"
            :disabled="disabled"
            @update:model-value="patchStep({ selector: { ...step.selector!, strategy: $event as AppiumSelector['strategy'] } })"
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
            @update:model-value="patchStep({ selector: { ...step.selector!, value: String($event) } })"
          />
        </el-form-item>
      </div>
      <div v-if="step.selector" class="appium-flow-editor__grid">
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
      <el-form-item v-if="step.type !== 'visualChange'" label="可选步骤">
        <el-switch
          :model-value="Boolean(step.optional)"
          :disabled="disabled"
          active-text="找不到时跳过"
          inactive-text="找不到时失败"
          @update:model-value="patchStep({ optional: Boolean($event) })"
        />
      </el-form-item>
      <div v-if="defaultKind() === 'condition'" class="appium-flow-editor__grid">
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
