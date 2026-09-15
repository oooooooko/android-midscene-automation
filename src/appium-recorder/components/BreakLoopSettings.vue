<script setup lang="ts">
import { computed } from 'vue';
import type { AppiumRecordedStep } from '../types';
import { enclosingLoops } from '../bounded-loop';

const props = defineProps<{ step: AppiumRecordedStep; steps: AppiumRecordedStep[]; disabled?: boolean }>();
const emit = defineEmits<{ update: [patch: Partial<AppiumRecordedStep>] }>();
const loops = computed(() => enclosingLoops(props.steps, props.step));
</script>

<template>
  <el-form-item label="退出目标循环">
    <el-select class="break-loop-target" popper-class="break-loop-target-popper" :model-value="step.breakLoopTargetId || loops[0]?.id" :disabled="disabled" aria-label="退出目标循环" @update:model-value="emit('update', { breakLoopTargetId: $event })">
      <el-option class="break-loop-target-option" v-for="(loop, index) in loops" :key="loop.id" :value="loop.id" :label="`${loop.label}（${index === 0 ? '当前循环' : `外层 ${index}`} · 节点 ${steps.findIndex(item => item.id === loop.id) + 1}）`" />
    </el-select>
  </el-form-item>
</template>

<style scoped>
.break-loop-target { width: 100%; min-width: 0; }
.break-loop-target :deep(.el-select__wrapper) { height: auto; min-height: 36px; }
.break-loop-target :deep(.el-select__placeholder) {
  position: relative; top: auto; transform: none; z-index: 0; pointer-events: none;
  white-space: normal; overflow-wrap: anywhere; line-height: 22px;
}
.break-loop-target :deep(.el-select__input-wrapper) { position: absolute; width: 100%; }
.break-loop-target-option { height: auto; min-height: 34px; padding-top: 6px; padding-bottom: 6px; white-space: normal; overflow-wrap: anywhere; line-height: 22px; }
:global(.break-loop-target-popper) { max-width: calc(100vw - 32px); }
</style>
