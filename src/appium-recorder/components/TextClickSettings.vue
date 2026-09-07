<script setup lang="ts">
import type { AppiumRecordedStep } from '../types';
const props = defineProps<{ step: AppiumRecordedStep; disabled?: boolean }>();
const emit = defineEmits<{ update: [patch: Partial<AppiumRecordedStep>] }>();
</script>

<template>
  <el-form-item label="点击文字" required>
    <el-input :model-value="step.value || ''" :disabled="disabled" maxlength="1000" aria-label="点击文字"
      @update:model-value="emit('update', { value: String($event) })" />
  </el-form-item>
  <el-form-item label="文本匹配方式">
    <el-select :model-value="step.flow?.textMatch || 'contains'" :disabled="disabled"
      @update:model-value="emit('update', { flow: { ...props.step.flow, textMatch: $event } })">
      <el-option label="精准匹配（完全一致）" value="exact" />
      <el-option label="模糊匹配（包含）" value="contains" />
    </el-select>
  </el-form-item>
</template>
