<script setup lang="ts">
import type { AppiumRecordedStep, AppiumSelector } from '../types';

type FlowKind = 'action' | 'condition' | 'assertion';

const props = defineProps<{
  step: AppiumRecordedStep;
  index: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [payload: { index: number; step: AppiumRecordedStep }];
}>();

function defaultKind(): FlowKind {
  if (props.step.flow?.nodeKind) return props.step.flow.nodeKind;
  if (props.step.type === 'assertExists' || props.step.type === 'assertText') return 'assertion';
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
        <el-form-item label="超时时间 ms">
          <el-input-number
            :model-value="step.timeoutMs || undefined"
            :disabled="disabled"
            :min="0"
            :max="999999"
            controls-position="right"
            @update:model-value="patchStep({ timeoutMs: Number($event || 0) || undefined })"
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
      <el-form-item label="可选步骤">
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
