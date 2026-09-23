<script setup lang="ts">
import type { ConfigForm } from '../../types';
import FlowAppearanceSettings from './FlowAppearanceSettings.vue';
import AiDeduplicationSettings from './AiDeduplicationSettings.vue';
import AiPromptPresetsSettings from './AiPromptPresetsSettings.vue';

defineProps<{
  configForm: ConfigForm;
  testingModelKey: string;
  testStatus?: string;
  saveStatus?: string;
}>();
defineEmits<{ testModel: [] }>();
</script>

<template>
  <el-card shadow="never" class="config-module-card config-appium-card" style="margin-bottom:20px">
    <template #header><div class="panel-header"><span>AI 识别配置</span><span v-if="saveStatus" class="config-save-status" role="status">{{ saveStatus }}</span></div></template>
    <div class="config-ai-layout">
      <section aria-labelledby="appium-ai-model-title">
        <h3 id="appium-ai-model-title" class="config-ai-title">模型连接</h3>
        <el-form label-position="top" :disabled="!!testingModelKey">
          <el-form-item label="Base URL"><el-input v-model="configForm.appium.model.baseUrl" /></el-form-item>
          <el-form-item label="API Key"><el-input v-model="configForm.appium.model.apiKey" type="password" show-password /></el-form-item>
          <el-form-item label="Model Name"><el-input v-model="configForm.appium.model.name" placeholder="支持图片输入的模型" /></el-form-item>
          <el-form-item v-if="testStatus" label="测试结果"><el-input :model-value="testStatus" readonly /></el-form-item>
          <el-button :loading="testingModelKey === 'appium'" @click="$emit('testModel')">测试并保存</el-button>
        </el-form>
      </section>
      <el-form label-position="top" class="config-ai-dedup">
        <AiDeduplicationSettings v-model="configForm.appium.aiDeduplication" />
      </el-form>
    </div>
    <AiPromptPresetsSettings v-model="configForm.appium.aiPromptPresets" />
  </el-card>
  <el-card shadow="never" class="config-module-card config-appium-card">
    <template #header>
      <div class="panel-header">
        <span>回放截图</span>
      </div>
    </template>
    <el-form label-position="top">
      <el-form-item label="截图与 HTML 报告">
        <el-switch v-model="configForm.appium.screenshotReport" aria-label="截图与 HTML 报告" />
      </el-form-item>
    </el-form>
    <el-alert title="默认关闭。开启后将在节点执行前后截图并生成 HTML 报告，截图会增加回放耗时，实际操作间隔可能超过设置的延时时间。" type="warning" :closable="false" show-icon />
  </el-card>
  <FlowAppearanceSettings v-model="configForm.appium.flowBackgroundColor" v-model:line-color="configForm.appium.flowLineColor" />
</template>

<style scoped>
.config-save-status { font-size: 12px; font-weight: 400; color: var(--el-text-color-secondary); }
.config-ai-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; }
.config-ai-title { margin: 0 0 20px; font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); }
.config-ai-dedup { min-width: 0; padding-left: 32px; border-left: 1px solid var(--el-border-color-lighter); }
@media (max-width: 1000px) {
  .config-ai-layout { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .config-ai-dedup { padding: 24px 0 0; border-left: 0; border-top: 1px solid var(--el-border-color-lighter); }
}
</style>
