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
  <div class="script-parameter-settings">
    <section class="script-parameter-settings__section">
      <div class="script-parameter-settings__heading">
        <strong>传入子脚本参数</strong>
        <span>同名参数会覆盖子脚本中的变量值</span>
      </div>
      <VariableTable layout="cards" empty-text="暂无传入参数" :model-value="step.parameters || []" :disabled="disabled" @update:model-value="emit('update', { parameters: $event })" />
    </section>
    <section class="script-parameter-settings__section">
      <div class="script-parameter-settings__heading">
        <strong>返回值映射</strong>
        <span>将子脚本执行后的变量保存到当前脚本</span>
      </div>
      <div class="return-mappings">
      <div v-for="(item, index) in step.returns || []" :key="index" class="return-row">
        <label><span>子脚本变量</span><el-input :model-value="item.name" placeholder="例如：result" aria-label="子脚本返回变量" :disabled="disabled" @update:model-value="update(index, { name: String($event) })" /></label>
        <span class="return-row__arrow">→</span>
        <label><span>当前脚本变量</span><el-input :model-value="item.target" placeholder="例如：deviceResult" aria-label="返回目标变量" :disabled="disabled" @update:model-value="update(index, { target: String($event) })" /></label>
        <el-tooltip content="删除映射"><el-button :icon="Delete" text :disabled="disabled" aria-label="删除返回映射" @click="emit('update', { returns: step.returns!.filter((_, i) => i !== index) })" /></el-tooltip>
      </div>
      <div v-if="!(step.returns || []).length" class="return-mappings__empty">
        <span>无需获取子脚本返回值</span>
        <small>需要继续使用子脚本产生的变量时再添加映射</small>
      </div>
      <el-button class="return-mappings__add" :icon="Plus" :disabled="disabled" size="small" @click="emit('update', { returns: [...(step.returns || []), { name: '', target: '' }] })">新增返回映射</el-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.script-parameter-settings { container-type: inline-size; display: grid; width: 100%; gap: 18px; }
.script-parameter-settings__section { min-width: 0; }
.script-parameter-settings__section + .script-parameter-settings__section { padding-top: 18px; border-top: 1px solid var(--ui-border); }
.script-parameter-settings__heading { display: grid; gap: 4px; margin-bottom: 10px; }
.script-parameter-settings__heading strong { color: var(--ui-text); font-size: 14px; font-weight: 600; }
.script-parameter-settings__heading span { color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
.return-mappings { width: 100%; }
.return-row { display: grid; grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr) 28px; gap: 8px; align-items: end; margin-bottom: 10px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); background: var(--ui-surface); }
.return-row label { display: grid; min-width: 0; gap: 6px; }
.return-row label > span { color: var(--ui-text-secondary); font-size: 12px; line-height: 1; }
.return-row__arrow { align-self: end; padding-bottom: 7px; color: var(--ui-text-muted); text-align: center; }
.return-mappings__empty { display: grid; place-items: center; gap: 7px; min-height: 76px; padding: 14px; border: 1px dashed var(--ui-border-strong); border-radius: var(--ui-radius-control); background: var(--ui-bg-soft); color: var(--ui-text-secondary); text-align: center; }
.return-mappings__empty small { color: var(--ui-text-muted); font-size: 12px; }
.return-mappings__add { margin-top: 10px; }
@container (max-width: 390px) {
  .return-row { grid-template-columns: minmax(0, 1fr) 28px; }
  .return-row label { grid-column: 1; }
  .return-row__arrow { display: none; }
  .return-row > .el-button { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
}
</style>
