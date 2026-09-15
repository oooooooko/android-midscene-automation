<script setup lang="ts">
import type { AppiumRecordedStep } from '../types';
import { sensitiveVariableName, type VariableExtraction } from '../variables';
const props = defineProps<{ step: AppiumRecordedStep; disabled?: boolean }>();
const emit = defineEmits<{ update: [Partial<AppiumRecordedStep>] }>();
function update(patch: Partial<VariableExtraction>) {
  emit('update', { extractVariable: { name: '', attribute: 'text', ...props.step.extractVariable, ...patch } });
}
</script>

<template>
  <el-form-item label="保存到当前脚本变量"><el-input :model-value="step.extractVariable?.name || ''" :disabled="disabled" aria-label="提取变量名" @update:model-value="update({ name: String($event) })" /></el-form-item>
  <el-form-item label="组件属性"><el-select :model-value="step.extractVariable?.attribute || 'text'" :disabled="disabled" filterable allow-create default-first-option aria-label="提取组件属性" @update:model-value="update({ attribute: String($event) })">
    <el-option v-for="name in ['text', 'content-desc', 'checked', 'selected', 'enabled', 'resource-id', 'class']" :key="name" :label="name" :value="name" />
  </el-select></el-form-item>
  <el-form-item label="敏感变量"><el-checkbox :model-value="step.extractVariable?.sensitive || sensitiveVariableName(step.extractVariable?.name || '')" :disabled="disabled || sensitiveVariableName(step.extractVariable?.name || '')" @update:model-value="update({ sensitive: Boolean($event) })" /></el-form-item>
</template>
