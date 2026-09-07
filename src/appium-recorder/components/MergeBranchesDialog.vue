<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { AppiumRecordedStep } from '../types';
import { branchSteps, mergeBranches } from '../flow-merge';
import { flowBranchLabel } from '../flow-labels';

const props = defineProps<{ steps: AppiumRecordedStep[]; conditionId: string; disabled?: boolean }>();
const emit = defineEmits<{ close: []; confirm: [steps: AppiumRecordedStep[]] }>();
const commonId = ref('');
const duplicateId = ref('');
const confirmed = ref(false);
const retainedSide = ref<'yes' | 'no'>('yes');
const condition = computed(() => props.steps.find((step) => step.id === props.conditionId));
const candidates = computed(() => branchSteps(props.steps, props.conditionId, retainedSide.value));
const duplicates = computed(() => branchSteps(props.steps, props.conditionId, retainedSide.value === 'yes' ? 'no' : 'yes'));
const preview = computed(() => {
  if (!commonId.value) return undefined;
  try { return mergeBranches(props.steps, props.conditionId, commonId.value, duplicateId.value); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
});
watch(() => props.conditionId, () => {
  retainedSide.value = branchSteps(props.steps, props.conditionId, 'yes').length ? 'yes' : 'no';
  commonId.value = ''; duplicateId.value = ''; confirmed.value = false;
});
// 切换方向时清空此前的选择和删除确认，避免误删新方向下的节点。
watch(retainedSide, () => { commonId.value = ''; duplicateId.value = ''; confirmed.value = false; });
watch(commonId, () => { duplicateId.value = ''; confirmed.value = false; });
watch(duplicateId, () => { confirmed.value = false; });
function submit() {
  if (props.disabled || !preview.value || typeof preview.value === 'string') return;
  if (preview.value.removedCount && !confirmed.value) return;
  try {
    emit('confirm', mergeBranches(props.steps, props.conditionId, commonId.value, duplicateId.value).steps);
    emit('close');
  } catch (error) { ElMessage.error(String(error)); }
}
</script>

<template>
  <el-dialog :model-value="Boolean(conditionId)" title="合并分支" width="min(520px, 94vw)" append-to-body :close-on-click-modal="false" @close="emit('close')">
    <el-form label-position="top">
      <el-form-item label="合并方向">
        <el-radio-group v-model="retainedSide" aria-label="合并方向">
          <el-radio-button value="yes">保留左侧流程</el-radio-button>
          <el-radio-button value="no">保留右侧流程</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="保留的公共流程起点">
        <el-select v-model="commonId" aria-label="保留的公共流程起点" style="width: 100%">
          <el-option v-for="step in candidates" :key="step.id" :value="step.id"
            :label="`${condition ? flowBranchLabel(condition, step.flow!.parentBranch!) : ''} · ${step.label}`" />
        </el-select>
      </el-form-item>
      <el-form-item :label="retainedSide === 'yes' ? '右侧重复部分起点' : '左侧重复部分起点'">
        <el-select v-model="duplicateId" :disabled="!commonId" aria-label="另一侧重复部分起点" style="width: 100%">
          <el-option value="" label="不删除，保留另一侧全部操作后接入" />
          <el-option v-for="step in duplicates" :key="step.id" :value="step.id" :label="step.label" />
        </el-select>
      </el-form-item>
      <el-alert v-if="typeof preview === 'string'" :title="preview" type="error" :closable="false" />
      <el-checkbox v-else-if="preview?.removedCount" v-model="confirmed">确认删除另一侧从所选起点开始的 {{ preview.removedCount }} 个节点</el-checkbox>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :disabled="disabled || !preview || typeof preview === 'string' || Boolean(preview.removedCount && !confirmed)" @click="submit">合并分支</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:deep(.el-checkbox) { height: auto; white-space: normal; }
:deep(.el-checkbox__label) { white-space: normal; overflow-wrap: anywhere; }
</style>
