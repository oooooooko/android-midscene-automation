<script setup lang="ts">
import type { AppiumRecordedStep, AppiumSelector } from '../types';
import { defaultLoopConfig, MAX_LOOP_ITERATIONS } from '../bounded-loop';

const props = defineProps<{ step: AppiumRecordedStep; disabled?: boolean }>();
const emit = defineEmits<{ update: [patch: Partial<AppiumRecordedStep>] }>();
function patch(config: Partial<NonNullable<AppiumRecordedStep['loop']>>) {
  emit('update', { loop: { ...defaultLoopConfig(), ...props.step.loop, ...config } });
}
function selector(patch: Partial<AppiumSelector>) {
  emit('update', { selector: { strategy: 'id', value: '', ...props.step.selector, ...patch } });
}
</script>

<template>
  <el-form-item label="循环方式">
    <el-select :model-value="step.loop?.exitWhen || 'never'" :disabled="disabled" @update:model-value="patch({ exitWhen: $event })">
      <el-option value="never" label="固定次数" />
      <el-option value="exists" label="元素出现时退出" />
      <el-option value="notExists" label="元素消失时退出" />
    </el-select>
  </el-form-item>
  <el-form-item :label="step.loop?.exitWhen === 'never' ? '执行次数' : '最大执行次数'" required>
    <el-input-number :model-value="step.loop?.maxIterations" :disabled="disabled" :min="1" :max="MAX_LOOP_ITERATIONS" :precision="0" controls-position="right" @update:model-value="patch({ maxIterations: Number($event) })" />
  </el-form-item>
  <template v-if="step.loop?.exitWhen && step.loop.exitWhen !== 'never'">
    <el-form-item label="退出条件定位方式">
      <el-select :model-value="step.selector?.strategy || 'id'" :disabled="disabled" @update:model-value="selector({ strategy: $event })">
        <el-option value="id" label="Resource ID" /><el-option value="accessibilityId" label="Accessibility ID" />
        <el-option value="xpath" label="XPath" /><el-option value="androidUiAutomator" label="UiAutomator" />
      </el-select>
    </el-form-item>
    <el-form-item label="退出条件定位内容" required>
      <el-input type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" :model-value="step.selector?.value || ''" :disabled="disabled" @update:model-value="selector({ value: $event })" />
    </el-form-item>
  </template>
</template>
