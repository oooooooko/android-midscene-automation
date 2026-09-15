<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { AppiumRecordedStep } from '../types';
import { branchSteps, mergeBranches } from '../flow-merge';
import { flowBranchLabel } from '../flow-labels';
import { unmergeBranches, type AddedNodeSide } from '../flow-unmerge';

const props = defineProps<{ steps: AppiumRecordedStep[]; conditionId: string; disabled?: boolean }>();
const emit = defineEmits<{ close: []; confirm: [steps: AppiumRecordedStep[]] }>();
const commonId = ref('');
const duplicateId = ref('');
const confirmed = ref(false);
const retainedSide = ref<'yes' | 'no'>('yes');
const condition = computed(() => props.steps.find((step) => step.id === props.conditionId));
const unmerging = ref(false);
const addedSide = ref<AddedNodeSide>('both');
const undoPreview = computed(() => {
  if (!unmerging.value) return undefined;
  try { return unmergeBranches(props.steps, props.conditionId, addedSide.value); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
});
const candidates = computed(() => branchSteps(props.steps, props.conditionId, retainedSide.value));
const duplicates = computed(() => branchSteps(props.steps, props.conditionId, retainedSide.value === 'yes' ? 'no' : 'yes'));
const preview = computed(() => {
  if (!commonId.value) return undefined;
  try { return mergeBranches(props.steps, props.conditionId, commonId.value, duplicateId.value); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
});
watch(() => props.conditionId, () => {
  if (props.conditionId) unmerging.value = Boolean(condition.value?.flow?.successTargetId);
  retainedSide.value = branchSteps(props.steps, props.conditionId, 'yes').length ? 'yes' : 'no';
  commonId.value = ''; duplicateId.value = ''; confirmed.value = false;
});
// 切换方向时清空此前的选择和删除确认，避免误删新方向下的节点。
watch(retainedSide, () => { commonId.value = ''; duplicateId.value = ''; confirmed.value = false; });
watch(commonId, () => { duplicateId.value = ''; confirmed.value = false; });
watch(duplicateId, () => { confirmed.value = false; });
function submit() {
  if (unmerging.value) {
    if (props.disabled || !undoPreview.value || typeof undoPreview.value === 'string') return;
    try { emit('confirm', unmergeBranches(props.steps, props.conditionId, addedSide.value).steps); emit('close'); }
    catch (error) { ElMessage.error(String(error)); }
    return;
  }
  if (props.disabled || !preview.value || typeof preview.value === 'string') return;
  if (preview.value.removedCount && !confirmed.value) return;
  try {
    emit('confirm', mergeBranches(props.steps, props.conditionId, commonId.value, duplicateId.value).steps);
    emit('close');
  } catch (error) { ElMessage.error(String(error)); }
}
</script>

<template>
  <el-dialog :model-value="Boolean(conditionId)" :title="unmerging ? '取消合并' : '合并分支'" width="min(520px, 94vw)" append-to-body :close-on-click-modal="false" @close="emit('close')">
    <el-form v-if="unmerging" label-position="top">
      <el-alert v-if="typeof undoPreview === 'string'" :title="undoPreview" type="warning" :closable="false" />
        <el-alert v-else title="还原合并前的分支及被删除的重复节点，保留现有节点配置修改。" type="info" :closable="false" />
        <el-form-item v-if="condition?.mergeUndo && (typeof undoPreview === 'string' || undoPreview?.addedCount)" label="公共流程新增操作保留位置">
          <el-radio-group v-model="addedSide" aria-label="新增操作保留位置">
            <el-radio-button value="both">两侧都保留</el-radio-button>
            <el-radio-button value="yes">仅左侧</el-radio-button>
            <el-radio-button value="no">仅右侧</el-radio-button>
          </el-radio-group>
          <p>原来源分支保留新增操作的相对位置；分配到另一侧的操作放在该分支末尾。</p>
        </el-form-item>
    </el-form>
    <el-form v-else label-position="top">
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
      <el-button v-if="unmerging" type="primary" :disabled="disabled || !undoPreview || typeof undoPreview === 'string'" @click="submit">取消合并</el-button>
      <el-button v-else type="primary" :disabled="disabled || !preview || typeof preview === 'string' || Boolean(preview.removedCount && !confirmed)" @click="submit">合并分支</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:deep(.el-checkbox) { height: auto; white-space: normal; }
:deep(.el-checkbox__label) { white-space: normal; overflow-wrap: anywhere; }
</style>
