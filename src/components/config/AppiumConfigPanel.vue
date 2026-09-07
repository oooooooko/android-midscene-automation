<script setup lang="ts">
import type { ConfigForm } from '../../types';
import FlowAppearanceSettings from './FlowAppearanceSettings.vue';
import { DEFAULT_FLOW_BACKGROUND, isHexColor } from '../../appium-recorder/flow-appearance';

defineProps<{
  configForm: ConfigForm;
  testingModelKey: string;
  isSavingModelConfig: boolean;
  testStatus?: string;
}>();
defineEmits<{ testModel: []; saveModelConfig: [] }>();
</script>

<template>
  <el-card shadow="never" class="config-module-card config-appium-card">
    <template #header>
      <div class="panel-header">
        <span>节点模型配置</span>
        <el-button type="primary" :loading="isSavingModelConfig" :disabled="!isHexColor(configForm.appium.flowBackgroundColor ?? DEFAULT_FLOW_BACKGROUND)" @click="$emit('saveModelConfig')">
          保存模型配置
        </el-button>
      </div>
    </template>
    <section class="appium-model-form">
      <div class="panel-header panel-header--sub">
        <span>AI 识别模型</span>
        <el-button :loading="testingModelKey === 'appium'" @click="$emit('testModel')">测试模型</el-button>
      </div>
      <el-form label-position="top">
        <el-form-item label="Base URL">
          <el-input v-model="configForm.appium.model.baseUrl" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="configForm.appium.model.apiKey" show-password />
        </el-form-item>
        <el-form-item label="Model Name">
          <el-input v-model="configForm.appium.model.name" placeholder="支持图片输入的模型" />
        </el-form-item>
        <el-form-item v-if="testStatus" label="测试结果">
          <el-input :model-value="testStatus" readonly />
        </el-form-item>
      </el-form>
    </section>
  </el-card>
  <FlowAppearanceSettings v-model="configForm.appium.flowBackgroundColor" :saving="isSavingModelConfig" @save="$emit('saveModelConfig')" />
</template>

<style scoped>
.appium-model-form { max-width: 640px; }
</style>
