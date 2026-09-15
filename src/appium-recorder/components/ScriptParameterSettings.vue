<script setup lang="ts">
import { Delete, Plus } from '@element-plus/icons-vue';
import VariableTable from './VariableTable.vue';
import type { AppiumRecordedStep } from '../types';
import type { ScriptReturn } from '../variables';
const props = defineProps<{ step: AppiumRecordedStep; disabled?: boolean }>();
const emit = defineEmits<{ update: [Partial<AppiumRecordedStep>] }>();
function update(index: number, patch: Partial<ScriptReturn>) {
  emit('update', { returns: (props.step.returns || []).map((item, i) => i === index ? { ...item, ...patch } : item) });
}
</script>

<template>
  <el-form-item label="传入子脚本参数"><VariableTable :model-value="step.parameters || []" :disabled="disabled" @update:model-value="emit('update', { parameters: $event })" /></el-form-item>
  <el-form-item label="返回值映射">
    <div class="return-mappings">
      <div v-for="(item, index) in step.returns || []" :key="index" class="return-row">
        <el-input :model-value="item.name" placeholder="子脚本变量名" aria-label="子脚本返回变量" :disabled="disabled" @update:model-value="update(index, { name: String($event) })" />
        <span>→</span>
        <el-input :model-value="item.target" placeholder="当前脚本变量名" aria-label="返回目标变量" :disabled="disabled" @update:model-value="update(index, { target: String($event) })" />
        <el-tooltip content="删除映射"><el-button :icon="Delete" text :disabled="disabled" aria-label="删除返回映射" @click="emit('update', { returns: step.returns!.filter((_, i) => i !== index) })" /></el-tooltip>
      </div>
      <el-button :icon="Plus" :disabled="disabled" size="small" @click="emit('update', { returns: [...(step.returns || []), { name: '', target: '' }] })">新增返回映射</el-button>
    </div>
  </el-form-item>
</template>

<style scoped>
.return-mappings { width: 100%; }
.return-row { display: grid; grid-template-columns: minmax(0, 1fr) 15px minmax(0, 1fr) 30px; gap: 5px; align-items: center; margin-bottom: 8px; }
</style>
