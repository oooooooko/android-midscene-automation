<script setup lang="ts">
import { DEFAULT_LOG_PREFIX } from '../stage-log';
import type { AppiumRecordedStep } from '../types';
defineProps<{ step: AppiumRecordedStep; disabled?: boolean }>();
defineEmits<{ update: [patch: Partial<AppiumRecordedStep>] }>();
</script>

<template>
  <el-form-item label="日志关键字">
    <el-input :model-value="step.logPrefix ?? DEFAULT_LOG_PREFIX" :disabled="disabled" maxlength="100"
      @update:model-value="$emit('update', { logPrefix: String($event) })" />
  </el-form-item>
  <el-form-item label="日志内容">
    <el-input :model-value="step.value || ''" :disabled="disabled" type="textarea" :rows="3" maxlength="4000"
      @update:model-value="$emit('update', { value: String($event) })" />
  </el-form-item>
</template>
