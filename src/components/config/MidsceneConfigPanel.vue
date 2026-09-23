<script setup lang="ts">
import { computed, reactive } from 'vue';
import { ArrowDown, QuestionFilled } from '@element-plus/icons-vue';
import {
  codexMidsceneModelOptions,
  midsceneModelPresets,
  midsceneModelOptions,
  midsceneModelFamilyOptions,
  type MidsceneModelProvider,
} from '../../config/midscene-model-presets';
import type { ConfigForm } from '../../types';

const props = defineProps<{
  configForm: ConfigForm;
  testingModelKey: string;
  modelTestStatus: { midscene: string; scriptOptimizer: string };
}>();

const emit = defineEmits<{
  testModel: [key: 'midscene' | 'scriptOptimizer'];
  updateMidsceneModelProvider: [provider: MidsceneModelProvider];
}>();

const activeMidsceneProvider = computed<MidsceneModelProvider>(() =>
  props.configForm.midscene.model.provider || 'custom',
);
const activePreset = computed(() => midsceneModelPresets.find(item => item.key === activeMidsceneProvider.value));
const modelFamilyOptions = computed(() => {
  if (activeMidsceneProvider.value === 'custom') return midsceneModelFamilyOptions;
  const families = activeMidsceneProvider.value === 'codex'
    ? codexMidsceneModelOptions.map(option => option.family)
    : activePreset.value?.modelFamilies ?? (activePreset.value ? [activePreset.value.modelFamily] : []);
  return [...new Set(families)].map(family => ({ label: family, value: family }));
});
const modelNameOptions = computed(() => activeMidsceneProvider.value === 'codex'
  ? codexMidsceneModelOptions
  : midsceneModelOptions.filter(option => modelFamilyOptions.value.some(family => family.value === option.family)));
const modelSearchActive = reactive({ name: false, family: false });
const modelSuggestions = (field: 'name' | 'family', query: string) => {
  const options = field === 'name' ? modelNameOptions.value : modelFamilyOptions.value;
  return modelSearchActive[field]
    ? options.filter(option => option.value.toLowerCase().includes(query.toLowerCase()))
    : options;
};
const modelConfigGuideUrl = 'https://midscenejs.com/zh/model-common-config.html#glm-v';

const updateMidsceneModelName = (value: string) => {
  props.configForm.midscene.model.name = value;
  const option = modelNameOptions.value.find((item) => item.value === value);
  if (option) {
    props.configForm.midscene.model.family = option.family;
  }
};

const updateMidsceneProvider = (value: string) => {
  if (value === 'custom' || value === 'codex') {
    emit('updateMidsceneModelProvider', value);
    return;
  }
  const preset = midsceneModelPresets.find(item => item.key === value);
  if (preset) emit('updateMidsceneModelProvider', preset.key);
};

const openModelConfigGuide = () => {
  window.open(modelConfigGuideUrl, '_blank', 'noopener,noreferrer');
};
</script>

<template>
  <el-card shadow="never" class="config-module-card config-midscene-card">
    <template #header>
      <div class="panel-header">
        <span class="panel-header__title">
          <span>模型配置</span>
          <el-tooltip content="模型参考配置" placement="top" :show-after="200">
            <el-button
              class="config-model-help"
              text
              :icon="QuestionFilled"
              aria-label="模型参考配置"
              @click="openModelConfigGuide"
            />
          </el-tooltip>
        </span>
      </div>
    </template>

    <div class="config-model-grid">
      <section>
        <div class="panel-header panel-header--sub">
          <span>Midscene 模型</span>
          <el-button
            :loading="testingModelKey === 'midscene'"
            :disabled="!!testingModelKey"
            @click="$emit('testModel', 'midscene')"
          >
            测试并保存
          </el-button>
        </div>
        <el-form label-position="top" :disabled="!!testingModelKey">
          <el-form-item label="接入方式">
            <el-select
              :model-value="activeMidsceneProvider"
              @change="updateMidsceneProvider"
            >
              <el-option label="自定义提供方" value="custom" />
              <el-option v-for="preset in midsceneModelPresets" :key="preset.key" :label="preset.label" :value="preset.key" />
              <el-option label="使用 Codex" value="codex" />
            </el-select>
          </el-form-item>

          <template v-if="activeMidsceneProvider !== 'codex'">
            <el-alert v-if="activePreset?.hint" class="config-form-alert" type="info" :closable="false" :title="activePreset.hint" />
            <el-form-item label="Base URL">
              <el-input
                v-model="configForm.midscene.model.baseUrl"
                placeholder="选择接入方式自动填充，也可手动修改"
              />
            </el-form-item>
            <el-form-item label="API Key">
              <el-input v-model="configForm.midscene.model.apiKey" show-password />
            </el-form-item>
          </template>
          <template v-else>
            <el-alert
              class="config-form-alert"
              type="info"
              :closable="false"
              title="复用 Codex 登录态，无需 API Key。请确保 codex 在 PATH 中可用，并已完成 codex login。"
            />
            <el-form-item label="Base URL">
              <el-input :model-value="configForm.midscene.model.baseUrl" readonly />
            </el-form-item>
          </template>
          <el-form-item label="Model Name">
            <el-autocomplete
              class="config-model-input"
              :model-value="configForm.midscene.model.name"
              :fetch-suggestions="(query: string) => modelSuggestions('name', query)"
              :debounce="0"
              :suffix-icon="ArrowDown"
              fit-input-width
              placeholder="选择或输入模型名称"
              @focus="modelSearchActive.name = false"
              @input="modelSearchActive.name = true"
              @update:model-value="updateMidsceneModelName"
            />
          </el-form-item>
          <el-form-item label="Model Family">
            <el-autocomplete
              v-model="configForm.midscene.model.family"
              class="config-model-input"
              :fetch-suggestions="(query: string) => modelSuggestions('family', query)"
              :debounce="0"
              :suffix-icon="ArrowDown"
              fit-input-width
              placeholder="选择或输入模型系列"
              @focus="modelSearchActive.family = false"
              @input="modelSearchActive.family = true"
            />
          </el-form-item>
          <el-form-item v-if="modelTestStatus.midscene" label="测试结果">
            <el-input :model-value="modelTestStatus.midscene" readonly />
          </el-form-item>
        </el-form>
      </section>

      <section>
        <div class="panel-header panel-header--sub">
          <span>脚本优化模型</span>
          <el-button
            :loading="testingModelKey === 'scriptOptimizer'"
            :disabled="!!testingModelKey"
            @click="$emit('testModel', 'scriptOptimizer')"
          >
            测试并保存
          </el-button>
        </div>
        <el-form label-position="top" :disabled="!!testingModelKey">
          <el-form-item label="Base URL">
            <el-input v-model="configForm.scriptOptimizer.model.baseUrl" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="configForm.scriptOptimizer.model.apiKey" show-password />
          </el-form-item>
          <el-form-item label="Model Name">
            <el-input v-model="configForm.scriptOptimizer.model.name" />
          </el-form-item>
          <el-form-item v-if="modelTestStatus.scriptOptimizer" label="测试结果">
            <el-input :model-value="modelTestStatus.scriptOptimizer" readonly />
          </el-form-item>
        </el-form>
      </section>
    </div>

  </el-card>
</template>

<style scoped>
.config-midscene-card :deep(.el-card__body) { background: var(--ui-bg-soft, #f8f9fb); }
.config-model-input { width: 100%; }
</style>
