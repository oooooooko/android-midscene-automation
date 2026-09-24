<script setup lang="ts">
import type { AiRecognitionModel } from '../../appium-recorder/ai-recognition';

const model = defineModel<AiRecognitionModel>({ required: true });
const props = defineProps<{
  title: string;
  badge: string;
  description: string;
  namePlaceholder: string;
  modelKey: 'appium' | 'promptOptimizer';
  testingModelKey: string;
  testStatus?: string;
}>();
defineEmits<{ test: [] }>();
</script>

<template>
  <el-card shadow="never" class="config-module-card config-appium-card appium-model-card">
    <template #header>
      <div class="panel-header">
        <span class="panel-header__title">
          <span>{{ title }}</span>
          <el-tag size="small" effect="plain">{{ badge }}</el-tag>
        </span>
      </div>
    </template>
    <p class="appium-model-description">{{ description }}</p>
    <el-form label-position="top" :disabled="!!testingModelKey">
      <el-form-item label="Base URL"><el-input v-model="model.baseUrl" placeholder="兼容 OpenAI 的 API 地址" /></el-form-item>
      <el-form-item label="API Key"><el-input v-model="model.apiKey" type="password" placeholder="已保存的 Key 显示为掩码，可输入新 Key 替换" show-password /></el-form-item>
      <el-form-item label="Model Name"><el-input v-model="model.name" :placeholder="namePlaceholder" /></el-form-item>
      <el-alert v-if="testStatus" class="appium-model-status" :title="testStatus"
        :type="testStatus.startsWith('测试通过') ? 'success' : 'warning'" :closable="false" show-icon />
      <div class="appium-model-actions">
        <el-button type="primary" plain :loading="testingModelKey === modelKey" :disabled="!!testingModelKey && testingModelKey !== modelKey" @click="$emit('test')">测试并保存</el-button>
      </div>
    </el-form>
  </el-card>
</template>

<style scoped>
.appium-model-description { min-height: 40px; margin: 0 0 18px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.appium-model-status { margin-bottom: 16px; }
.appium-model-actions { display: flex; justify-content: flex-end; }
</style>
