<script setup lang="ts">
import ReplayReportSummarySettings from './ReplayReportSummarySettings.vue';
import type { ConfigForm } from '../../types';
import FlowAppearanceSettings from './FlowAppearanceSettings.vue';
import AiDeduplicationSettings from './AiDeduplicationSettings.vue';
import AiPromptPresetsSettings from './AiPromptPresetsSettings.vue';
import AppiumModelSettings from './AppiumModelSettings.vue';

defineProps<{
  configForm: ConfigForm;
  testingModelKey: string;
  testStatus?: string;
  promptOptimizerTestStatus?: string;
  saveStatus?: string;
  saveFailed?: boolean;
}>();
defineEmits<{
  retrySave: []; testModel: []; testPromptOptimizerModel: [] }>();
</script>

<template>
  <div class="appium-config-stack">
    <section class="appium-config-section" aria-labelledby="appium-models-title">
      <header class="appium-section-heading">
        <div><h2 id="appium-models-title">模型服务</h2><p>不同任务使用独立模型，配置修改需测试通过后保存。</p></div>
        <span v-if="saveStatus" class="config-save-status" role="status">{{ saveStatus }}</span>
        <el-button v-if="saveFailed" link type="primary" @click="$emit('retrySave')">重试保存</el-button>
      </header>
      <div class="appium-model-grid">
        <AppiumModelSettings v-model="configForm.appium.model" title="AI 识别模型" badge="视觉"
          description="用于识别设备截图和持续观察，需要选择支持图片输入的模型。" name-placeholder="支持图片输入的模型"
          model-key="appium" :testing-model-key="testingModelKey" :test-status="testStatus" @test="$emit('testModel')" />
        <AppiumModelSettings v-if="configForm.appium.promptOptimizer" v-model="configForm.appium.promptOptimizer.model"
          title="提示词优化模型" badge="文本" description="用于优化 AI 识别和回放报告提示词，也用于生成回放测试报告总结，只需支持文本输入。"
          name-placeholder="用于优化提示词的文本模型" model-key="promptOptimizer" :testing-model-key="testingModelKey"
          :test-status="promptOptimizerTestStatus" @test="$emit('testPromptOptimizerModel')" />
      </div>
    </section>

    <section class="appium-config-section" aria-labelledby="appium-recognition-title">
      <header class="appium-section-heading"><div><h2 id="appium-recognition-title">AI 识别设置</h2><p>控制持续观察的截图筛选，并管理录制节点可选的常用提示词。</p></div></header>
      <div class="appium-settings-grid">
        <el-card shadow="never" class="config-module-card config-appium-card">
          <template #header><div class="panel-header"><span>持续观察截图去重</span></div></template>
          <el-form label-position="top"><AiDeduplicationSettings v-model="configForm.appium.aiDeduplication" /></el-form>
        </el-card>
        <el-card shadow="never" class="config-module-card config-appium-card">
          <template #header><div class="panel-header"><span>AI 识别预设提示词</span></div></template>
          <AiPromptPresetsSettings v-model="configForm.appium.aiPromptPresets" />
        </el-card>
      </div>
    </section>

    <section class="appium-config-section" aria-labelledby="appium-replay-title">
      <header class="appium-section-heading"><div><h2 id="appium-replay-title">回放与报告</h2><p>配置回放证据、基础报告和 AI 总结。</p></div></header>
      <el-card shadow="never" class="config-module-card config-appium-card">
        <template #header>
          <div class="panel-header">
            <span class="panel-header__title">
              <span>回放截图</span>
              <el-switch v-model="configForm.appium.screenshotReport" aria-label="截图与 HTML 报告" />
            </span>
          </div>
        </template>
        <el-alert title="开启后会在节点执行前后截图并生成 HTML 报告。截图会增加回放耗时，实际操作间隔可能超过设置的延时时间。" type="info" :closable="false" show-icon />
      </el-card>
      <ReplayReportSummarySettings v-if="configForm.appium.reportSummary" :config="configForm.appium.reportSummary" :testing-model-key="testingModelKey" />
    </section>

    <section class="appium-config-section" aria-labelledby="appium-editor-title">
      <header class="appium-section-heading"><div><h2 id="appium-editor-title">流程编辑器</h2><p>调整流程画布和连接线的显示颜色。</p></div></header>
      <FlowAppearanceSettings v-model="configForm.appium.flowBackgroundColor" v-model:line-color="configForm.appium.flowLineColor" />
    </section>
  </div>
</template>

<style scoped>
.config-save-status { font-size: 12px; font-weight: 400; color: var(--el-text-color-secondary); }
.appium-config-stack { display: grid; gap: 28px; }
.appium-config-section { display: grid; gap: 14px; min-width: 0; }
.appium-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 0 4px; }
.appium-section-heading h2 { margin: 0; color: var(--el-text-color-primary); font-size: 16px; line-height: 1.4; }
.appium-section-heading p { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.appium-model-grid, .appium-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
.appium-settings-grid > .config-appium-card { display: flex; flex-direction: column; }
.appium-settings-grid > .config-appium-card :deep(.el-card__body) { flex: 1; }
.appium-config-section > .config-appium-card + .config-appium-card { margin-top: 2px; }
@media (max-width: 1000px) {
  .appium-model-grid, .appium-settings-grid { grid-template-columns: minmax(0, 1fr); }
  .appium-section-heading { align-items: flex-start; flex-direction: column; }
}
</style>
