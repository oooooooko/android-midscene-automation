<script setup lang="ts">
import { Delete, Plus, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { sensitiveVariableName, type TestVariable } from '../variables';
const props = defineProps<{ modelValue: TestVariable[]; disabled?: boolean; layout?: 'table' | 'cards'; emptyText?: string }>();
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
  <div class="variable-table" :class="{ 'variable-table--cards': layout === 'cards' }">
    <template v-if="layout === 'cards'">
      <div v-if="modelValue.length" class="variable-table__cards">
        <div v-for="(row, index) in modelValue" :key="index" class="variable-table__card">
          <label class="variable-table__field">
            <span>变量名</span>
            <el-input :model-value="row.name" :disabled="disabled" placeholder="例如：account" aria-label="变量名" @update:model-value="update(index, { name: String($event) })" />
          </label>
          <label class="variable-table__field">
            <span>传入值</span>
            <el-input :model-value="row.value" :type="row.sensitive || sensitiveVariableName(row.name) ? 'password' : 'text'" :show-password="row.sensitive || sensitiveVariableName(row.name)" :disabled="disabled" placeholder="输入固定值或变量引用" aria-label="变量值" @update:model-value="update(index, { value: String($event) })" />
          </label>
          <div class="variable-table__card-footer">
            <el-checkbox :model-value="row.sensitive || sensitiveVariableName(row.name)" :disabled="disabled || sensitiveVariableName(row.name)" @update:model-value="update(index, { sensitive: Boolean($event) })">敏感值</el-checkbox>
            <div class="variable-table__actions">
              <el-tooltip content="复制变量引用"><el-button :icon="CopyDocument" text size="small" :disabled="!row.name" aria-label="复制变量引用" @click="copy(row.name)" /></el-tooltip>
              <el-tooltip content="删除参数"><el-button :icon="Delete" text size="small" :disabled="disabled" aria-label="删除变量" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))" /></el-tooltip>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="variable-table__empty">
        <span>{{ emptyText || '暂无变量' }}</span>
        <small>子脚本将使用自身已有的变量值</small>
        <el-button :icon="Plus" :disabled="disabled" size="small" @click="emit('update:modelValue', [{ name: '', value: '', sensitive: false }])">新增参数</el-button>
      </div>
    </template>
    <el-table v-else :data="modelValue" empty-text="暂无变量" size="small">
      <el-table-column label="变量名" min-width="110"><template #default="{ row, $index }"><el-input :model-value="row.name" :disabled="disabled" aria-label="变量名" @update:model-value="update($index, { name: String($event) })" /></template></el-table-column>
      <el-table-column label="值" min-width="125"><template #default="{ row, $index }"><el-input :model-value="row.value" :type="row.sensitive || sensitiveVariableName(row.name) ? 'password' : 'text'" :show-password="row.sensitive || sensitiveVariableName(row.name)" :disabled="disabled" aria-label="变量值" @update:model-value="update($index, { value: String($event) })" /></template></el-table-column>
      <el-table-column label="敏感" width="65"><template #default="{ row, $index }"><el-checkbox :model-value="row.sensitive || sensitiveVariableName(row.name)" :disabled="disabled || sensitiveVariableName(row.name)" aria-label="敏感变量" @update:model-value="update($index, { sensitive: Boolean($event) })" /></template></el-table-column>
      <el-table-column label="操作" width="76"><template #default="{ row, $index }"><div class="variable-table__actions">
        <el-tooltip content="复制引用"><el-button :icon="CopyDocument" text size="small" :disabled="!row.name" aria-label="复制变量引用" @click="copy(row.name)" /></el-tooltip>
        <el-tooltip content="删除变量"><el-button :icon="Delete" text size="small" :disabled="disabled" aria-label="删除变量" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== $index))" /></el-tooltip>
      </div></template></el-table-column>
    </el-table>
    <div v-if="layout !== 'cards' || modelValue.length" class="variable-table__footer">
      <el-button :icon="Plus" :disabled="disabled" size="small" @click="emit('update:modelValue', [...modelValue, { name: '', value: '', sensitive: false }])">{{ layout === 'cards' ? '新增参数' : '新增变量' }}</el-button>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.variable-table { min-width: 0; }
.variable-table__cards { display: grid; gap: 10px; }
.variable-table__card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); gap: 10px 12px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); background: var(--ui-surface); }
.variable-table__field { display: grid; min-width: 0; gap: 6px; }
.variable-table__field > span { color: var(--ui-text-secondary); font-size: 12px; line-height: 1; }
.variable-table__card-footer { display: flex; grid-column: 1 / -1; align-items: center; justify-content: space-between; min-height: 28px; padding-top: 2px; }
.variable-table__empty { display: grid; place-items: center; gap: 7px; min-height: 112px; padding: 16px; border: 1px dashed var(--ui-border-strong); border-radius: var(--ui-radius-control); background: var(--ui-bg-soft); color: var(--ui-text-secondary); text-align: center; }
.variable-table__empty small { color: var(--ui-text-muted); font-size: 12px; }
.variable-table__footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.variable-table__actions { display: flex; align-items: center; gap: 2px; }
.variable-table__actions :deep(.el-button) { width: 26px; height: 28px; padding: 0; }
.variable-table :deep(.el-table th.el-table__cell) { background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 12px; padding: 7px 0; }
.variable-table :deep(.el-table td.el-table__cell) { padding: 8px 0; }
.variable-table :deep(.el-table .cell) { padding: 0 8px; }
.variable-table :deep(.el-button + .el-button) { margin-left: 0; }
.variable-table--cards .variable-table__footer :deep(.el-button) { margin-left: 0; }
@container (max-width: 390px) {
  .variable-table__card { grid-template-columns: minmax(0, 1fr); }
  .variable-table__card-footer { grid-column: 1; }
}
.variable-table--cards { container-type: inline-size; }
</style>
