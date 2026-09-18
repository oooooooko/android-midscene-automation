<script setup lang="ts">
import type { AppiumRecordedStep } from '../types';
import { flowBranchLabel } from '../flow-labels';
defineProps<{ step: AppiumRecordedStep; disabled?: boolean }>();
defineEmits<{ update: [value: NonNullable<AppiumRecordedStep['timeoutBranch']>] }>();
</script>

<template>
  <el-form-item label="超时后处理">
    <el-select class="branch-timeout-select" size="small" popper-class="branch-timeout-popper" :model-value="step.timeoutBranch || 'stop'" :disabled="disabled" @update:model-value="$emit('update', $event)">
      <el-option label="未配置分支（超时终止）" value="stop" />
      <el-option :label="`进入左侧分支（${flowBranchLabel(step, 'yes')}）`" value="yes" />
      <el-option :label="`进入右侧分支（${flowBranchLabel(step, 'no')}）`" value="no" />
    </el-select>
  </el-form-item>
</template>

<style>
.el-select.branch-timeout-select { width: 240px; max-width: 100%; flex: none; }
.branch-timeout-popper .el-select-dropdown__list { padding: 4px 0; }
.branch-timeout-popper .el-select-dropdown__item { height: 28px; line-height: 28px; padding: 0 12px; font-size: 12px; }
.branch-timeout-popper .el-select-dropdown__item.is-selected { color: var(--el-color-primary); }
</style>
