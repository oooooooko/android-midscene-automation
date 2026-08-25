<script setup lang="ts">
import { computed } from 'vue';
import { Delete, Edit } from '@element-plus/icons-vue';
import ModelUsageChart from '../components/config/ModelUsageChart.vue';
import {
  codexMidsceneModelOptions,
  midsceneModelFamilyOptions,
  midsceneModelOptions,
  midsceneModelPresets,
  type MidsceneModelProvider,
  type MidsceneModelPresetKey,
} from '../config/midscene-model-presets';
import type { AppPreset, ConfigForm, ModelUsageRecord } from '../types';

type AppPresetForm = {
  id: string;
  name: string;
  packageName: string;
};

const props = defineProps<{
  configForm: ConfigForm;
  appPresets: AppPreset[];
  appPresetForm: AppPresetForm;
  testingModelKey: string;
  isSavingModelConfig: boolean;
  isSavingAppPreset: boolean;
  modelTestStatus: {
    midscene: string;
    scriptOptimizer: string;
  };
  modelUsageRecords: ModelUsageRecord[];
}>();

const emit = defineEmits<{
  testModel: [key: 'midscene' | 'scriptOptimizer'];
  saveModelConfig: [];
  saveAppPreset: [];
  editAppPreset: [app: AppPreset];
  deleteAppPreset: [id: string];
  updateMidsceneModelProvider: [provider: MidsceneModelProvider];
  applyMidsceneModelPreset: [key: MidsceneModelPresetKey];
}>();

const activeMidsceneProvider = computed<MidsceneModelProvider>(() =>
  props.configForm.midscene.model.provider === 'codex' ? 'codex' : 'custom',
);

const activeMidscenePresetKey = computed(() => {
  const model = props.configForm.midscene.model;
  return midsceneModelPresets.find(
    (preset) =>
      preset.baseUrl === model.baseUrl &&
      preset.modelName === model.name &&
      preset.modelFamily === model.family,
  )?.key || '';
});

const activeMidsceneModelOptions = computed(() =>
  activeMidsceneProvider.value === 'codex' ? codexMidsceneModelOptions : midsceneModelOptions,
);

const updateMidsceneModelName = (value: string) => {
  props.configForm.midscene.model.name = value;
  const option = activeMidsceneModelOptions.value.find((item) => item.value === value);
  if (option) {
    props.configForm.midscene.model.family = option.family;
  }
};

const applyMidscenePreset = (value: string) => {
  if (value === 'gpt' || value === 'doubao') {
    emit('applyMidsceneModelPreset', value);
  }
};

const updateMidsceneProvider = (value: string) => {
  if (value === 'custom' || value === 'codex') {
    emit('updateMidsceneModelProvider', value);
  }
};
</script>

<template>
  <div class="config-page">
    <section class="config-grid">
      <el-card shadow="never" class="config-module-card">
        <template #header>
          <div class="panel-header">
            <span>运行配置</span>
            <el-button type="primary" :loading="isSavingModelConfig" @click="$emit('saveModelConfig')">
              保存运行配置
            </el-button>
          </div>
        </template>

        <el-form label-position="top">
          <el-form-item label="Android SDK 路径">
            <el-input
              v-model="configForm.runtime.androidSdkPath"
              clearable
              placeholder="留空时读取 ANDROID_SDK_ROOT、ANDROID_HOME 或系统默认路径"
            />
          </el-form-item>
          <el-form-item label="回放报告目录">
            <el-input
              v-model="configForm.runtime.reportOutputPath"
              clearable
              placeholder="留空时保存到启动目录下的 output"
            />
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="config-module-card">
        <template #header>
          <div class="panel-header">
            <div class="panel-header__title">
              <span>预设 App 参数</span>
              <el-tag v-if="appPresetForm.id" size="small" type="warning">编辑中</el-tag>
            </div>
            <div class="panel-header__actions">
              <el-button type="primary" :loading="isSavingAppPreset" @click="$emit('saveAppPreset')">
                {{ appPresetForm.id ? '保存修改' : '保存 App' }}
              </el-button>
            </div>
          </div>
        </template>

        <el-form label-position="top">
          <el-form-item label="App 名称">
            <el-input v-model="appPresetForm.name" placeholder="例如：示例 App" />
          </el-form-item>
          <el-form-item label="App 包名">
            <el-input v-model="appPresetForm.packageName" placeholder="例如：com.example.app" />
          </el-form-item>
        </el-form>

        <div class="app-preset-list">
          <div v-for="app in appPresets" :key="app.id" class="app-preset-row">
            <div class="app-preset-row__main">
              <strong>{{ app.name }}</strong>
              <span>{{ app.packageName }}</span>
            </div>
            <div class="script-row__actions">
              <el-button text size="small" :icon="Edit" @click="$emit('editAppPreset', app)" />
              <el-button text size="small" :icon="Delete" @click="$emit('deleteAppPreset', app.id)" />
            </div>
          </div>
          <el-empty v-if="!appPresets.length" description="暂无预设 App" />
        </div>
      </el-card>

      <el-card shadow="never" class="config-module-card">
        <template #header>
          <div class="panel-header">
            <span>模型配置</span>
            <el-button type="primary" :loading="isSavingModelConfig" @click="$emit('saveModelConfig')">
              保存模型配置
            </el-button>
          </div>
        </template>

        <div class="config-model-grid">
          <section>
            <div class="panel-header panel-header--sub">
              <span>Midscene 模型</span>
              <el-button
                :loading="testingModelKey === 'midscene'"
                @click="$emit('testModel', 'midscene')"
              >
                测试模型
              </el-button>
            </div>
            <el-form label-position="top">
              <el-form-item label="接入方式">
                <el-select
                  :model-value="activeMidsceneProvider"
                  @change="updateMidsceneProvider"
                >
                  <el-option label="自定义提供方" value="custom" />
                  <el-option label="使用 Codex" value="codex" />
                </el-select>
              </el-form-item>

              <template v-if="activeMidsceneProvider === 'custom'">
                <el-form-item label="模型预设参数">
                  <el-select
                    :model-value="activeMidscenePresetKey"
                    placeholder="请选择模型预设"
                    @change="applyMidscenePreset"
                  >
                    <el-option
                      v-for="preset in midsceneModelPresets"
                      :key="preset.key"
                      :label="preset.label"
                      :value="preset.key"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="Base URL">
                  <el-input v-model="configForm.midscene.model.baseUrl" />
                </el-form-item>
                <el-form-item label="API Key">
                  <el-input v-model="configForm.midscene.model.apiKey" show-password />
                </el-form-item>
                <el-form-item label="Model Name">
                  <el-select
                    :model-value="configForm.midscene.model.name"
                    filterable
                    @change="updateMidsceneModelName"
                  >
                    <el-option
                      v-for="option in activeMidsceneModelOptions"
                      :key="option.value"
                      :label="option.label"
                      :value="option.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="Model Family">
                  <el-select v-model="configForm.midscene.model.family" filterable>
                    <el-option
                      v-for="option in midsceneModelFamilyOptions"
                      :key="option.value"
                      :label="option.label"
                      :value="option.value"
                    />
                  </el-select>
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
                <el-form-item label="Model Name">
                  <el-select
                    :model-value="configForm.midscene.model.name"
                    @change="updateMidsceneModelName"
                  >
                    <el-option
                      v-for="option in activeMidsceneModelOptions"
                      :key="option.value"
                      :label="option.label"
                      :value="option.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="Model Family">
                  <el-select v-model="configForm.midscene.model.family" disabled>
                    <el-option label="gpt-5" value="gpt-5" />
                  </el-select>
                </el-form-item>
              </template>
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
                @click="$emit('testModel', 'scriptOptimizer')"
              >
                测试模型
              </el-button>
            </div>
            <el-form label-position="top">
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

        <ModelUsageChart
          :records="modelUsageRecords"
        />
      </el-card>

    </section>
  </div>
</template>
