<script setup lang="ts">
import { Delete, Plus, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { sensitiveVariableName, type TestVariable } from '../variables';
const props = defineProps<{ modelValue: TestVariable[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [TestVariable[]] }>();
function update(index: number, patch: Partial<TestVariable>) {
  emit('update:modelValue', props.modelValue.map((item, i) => i === index ? { ...item, ...patch } : item));
}
async function copy(name: string) {
  try { await navigator.clipboard.writeText(`{{${name}}}`); ElMessage.success('已复制变量引用'); }
  catch { ElMessage.error('复制失败'); }
}
</script>

<template>
  <div class="variable-table">
    <el-table :data="modelValue" empty-text="暂无变量" size="small">
      <el-table-column label="变量名" min-width="110"><template #default="{ row, $index }"><el-input :model-value="row.name" :disabled="disabled" aria-label="变量名" @update:model-value="update($index, { name: String($event) })" /></template></el-table-column>
      <el-table-column label="值" min-width="125"><template #default="{ row, $index }"><el-input :model-value="row.value" :type="row.sensitive || sensitiveVariableName(row.name) ? 'password' : 'text'" :show-password="row.sensitive || sensitiveVariableName(row.name)" :disabled="disabled" aria-label="变量值" @update:model-value="update($index, { value: String($event) })" /></template></el-table-column>
      <el-table-column label="敏感" width="65"><template #default="{ row, $index }"><el-checkbox :model-value="row.sensitive || sensitiveVariableName(row.name)" :disabled="disabled || sensitiveVariableName(row.name)" aria-label="敏感变量" @update:model-value="update($index, { sensitive: Boolean($event) })" /></template></el-table-column>
      <el-table-column label="操作" width="76"><template #default="{ row, $index }"><div class="variable-table__actions">
        <el-tooltip content="复制引用"><el-button :icon="CopyDocument" text size="small" :disabled="!row.name" aria-label="复制变量引用" @click="copy(row.name)" /></el-tooltip>
        <el-tooltip content="删除变量"><el-button :icon="Delete" text size="small" :disabled="disabled" aria-label="删除变量" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== $index))" /></el-tooltip>
      </div></template></el-table-column>
    </el-table>
    <div class="variable-table__footer">
      <el-button :icon="Plus" :disabled="disabled" size="small" @click="emit('update:modelValue', [...modelValue, { name: '', value: '', sensitive: false }])">新增变量</el-button>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.variable-table { min-width: 0; }
.variable-table__footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.variable-table__actions { display: flex; align-items: center; gap: 2px; }
.variable-table__actions :deep(.el-button) { width: 26px; height: 28px; padding: 0; }
.variable-table :deep(.el-table th.el-table__cell) { background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 12px; padding: 7px 0; }
.variable-table :deep(.el-table td.el-table__cell) { padding: 8px 0; }
.variable-table :deep(.el-table .cell) { padding: 0 8px; }
.variable-table :deep(.el-button + .el-button) { margin-left: 0; }
</style>
