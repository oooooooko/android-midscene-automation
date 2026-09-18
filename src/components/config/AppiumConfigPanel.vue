<script setup lang="ts">
import type { ConfigForm } from '../../types';
import FlowAppearanceSettings from './FlowAppearanceSettings.vue';

defineProps<{
  configForm: ConfigForm;
  testingModelKey: string;
  isSavingModelConfig: boolean;
  testStatus?: string;
}>();
defineEmits<{ testModel: []; saveModelConfig: [] }>();
</script>

<template>
  <FlowAppearanceSettings v-model="configForm.appium.flowBackgroundColor" :saving="isSavingModelConfig" @save="$emit('saveModelConfig')" />
</template>
