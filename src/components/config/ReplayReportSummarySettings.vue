<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { checkReportSummaryModel, optimizeAppiumPrompt } from '../../appium-recorder/api';
import { REPORT_SUMMARY_PROMPT_PRESETS, validateReportSummaryPrompt, type ReportSummaryConfig } from '../../appium-recorder/report-summary';
const props = defineProps<{ config: ReportSummaryConfig; testingModelKey?: string }>();
const promptPresets = computed(() => [...REPORT_SUMMARY_PROMPT_PRESETS, ...props.config.customPresets]);
const selectedScenario = computed(() => promptPresets.value.find(preset => preset.prompt === props.config.prompt)?.name);
const optimizingPrompt = shallowRef(false);
const modelStatus = shallowRef<'idle' | 'checking' | 'available' | 'unavailable'>('idle');
const modelStatusDetail = shallowRef('');
let modelCheckRevision = 0;
let optimizeController: AbortController | undefined;
onBeforeUnmount(() => { optimizeController?.abort(); modelCheckRevision += 1; });
async function validateSummaryModel() {
  const revision = ++modelCheckRevision;
  if (!props.config.enabled) { modelStatus.value = 'idle'; modelStatusDetail.value = ''; return; }
  modelStatus.value = 'checking';
  modelStatusDetail.value = '';
  try {
    const status = await checkReportSummaryModel();
    if (revision !== modelCheckRevision || !props.config.enabled) return;
    modelStatus.value = status.available ? 'available' : 'unavailable';
    modelStatusDetail.value = status.message || '';
  } catch (error) {
    if (revision !== modelCheckRevision || !props.config.enabled) return;
    modelStatus.value = 'unavailable';
    modelStatusDetail.value = error instanceof Error ? error.message : '模型验证失败';
  }
}
watch(() => props.config.enabled, () => { void validateSummaryModel(); }, { immediate: true });
watch(() => props.testingModelKey, (current, previous) => {
  if (props.config.enabled && previous === 'promptOptimizer' && !current) void validateSummaryModel();
});
function selectScenario(name: string) {
  const preset = promptPresets.value.find(item => item.name === name);
  if (preset) props.config.prompt = preset.prompt;
}
async function addScenario() {
  try {
    const prompt = validateReportSummaryPrompt(props.config.prompt);
    const result = await ElMessageBox.prompt('当前报告提示词将保存为新的测试场景。', '新增测试场景', {
      inputPlaceholder: '请输入测试场景名称',
      inputValidator: value => {
        const name = value.trim();
        if (!name || name.length > 80) return '场景名称不能为空，且不能超过 80 字';
        if (promptPresets.value.some(item => item.name === name)) return '场景名称已存在';
        return true;
      },
      confirmButtonText: '新增',
      cancelButtonText: '取消',
    });
    props.config.customPresets.push({ name: result.value.trim(), prompt });
    ElMessage.success('测试场景已新增');
  } catch (action) {
    if (action !== 'cancel' && action !== 'close') ElMessage.error(action instanceof Error ? action.message : '新增测试场景失败');
  }
}
async function optimizePrompt() {
  if (optimizingPrompt.value) return;
  optimizeController = new AbortController();
  optimizingPrompt.value = true;
  try {
    props.config.prompt = (await optimizeAppiumPrompt({
      kind: 'reportSummary',
      prompt: props.config.prompt,
    }, optimizeController.signal)).prompt;
    ElMessage.success('报告提示词已优化');
  } catch (error) {
    if (!optimizeController.signal.aborted) ElMessage.error(error instanceof Error ? error.message : '提示词优化失败');
  } finally {
    optimizingPrompt.value = false;
  }
}
</script>

<template>
  <el-card shadow="never" class="config-module-card config-appium-card report-summary-card">
    <template #header>
      <div class="panel-header">
        <span class="panel-header__title">
          <span>回放报告总结</span>
          <el-switch v-model="config.enabled" aria-label="启用回放报告总结" />
          <el-tag v-if="config.enabled && modelStatus === 'checking'" size="small" effect="plain" type="info">正在验证模型…</el-tag>
          <el-tooltip v-else-if="config.enabled && modelStatus === 'unavailable'" :content="modelStatusDetail || '回放时将跳过 AI 总结并保留默认基础报告'" placement="top">
            <el-tag size="small" effect="plain" type="warning">模型不可用，使用默认模板</el-tag>
          </el-tooltip>
        </span>
      </div>
    </template>
    <el-alert class="report-summary-description" title="开启后使用上方的提示词优化模型，根据日志和节点配置生成 Markdown 报告。总结耗时不计入测试总时长，生成失败时保留基础报告。" type="info" :closable="false" show-icon />
    <el-form label-position="top" class="report-summary-prompt">
        <el-form-item label="测试场景">
          <div class="report-summary-scenario">
            <el-select :model-value="selectedScenario" :disabled="optimizingPrompt" filterable placeholder="选择测试场景，或在下方输入" aria-label="选择报告测试场景" @change="selectScenario">
              <el-option v-for="preset in promptPresets" :key="preset.name" :label="preset.name" :value="preset.name" />
            </el-select>
            <el-button :icon="Plus" :disabled="optimizingPrompt || !config.prompt.trim()" @click="addScenario">新增场景</el-button>
          </div>
        </el-form-item>
        <el-form-item label="报告提示词">
          <el-input v-model="config.prompt" type="textarea" :rows="14" maxlength="20000" show-word-limit aria-label="报告提示词" :disabled="optimizingPrompt" />
        </el-form-item>
        <div class="report-summary-prompt-actions">
          <el-button :loading="optimizingPrompt" :disabled="!config.prompt.trim()" @click="optimizePrompt">优化提示词</el-button>
        </div>
    </el-form>
  </el-card>
</template>

<style scoped>
.report-summary-description { margin-bottom: 20px; }
.report-summary-prompt { min-width: 0; }
.report-summary-scenario { display: flex; width: 100%; gap: 10px; }
.report-summary-scenario .el-select { flex: 1; min-width: 0; }
.report-summary-prompt-actions { display: flex; justify-content: flex-end; }
</style>
