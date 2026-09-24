<script setup lang="ts">
import { Delete, Edit } from '@element-plus/icons-vue';
import type { AppPreset, ConfigForm } from '../../types';

defineProps<{
  configForm: ConfigForm;
  appPresets: AppPreset[];
  appPresetForm: Pick<AppPreset, 'id' | 'name' | 'packageName'>;
  isSavingModelConfig: boolean;
  isSavingAppPreset: boolean;
}>();

defineEmits<{
  saveModelConfig: [];
  saveAppPreset: [];
  editAppPreset: [app: AppPreset];
  deleteAppPreset: [id: string];
  cancelAppPresetEdit: [];
}>();
</script>

<template>
  <div class="config-grid">
    <el-card shadow="never" class="config-module-card">
      <template #header>
        <div class="panel-header">
          <span>运行配置</span>
          <el-button type="primary" :loading="isSavingModelConfig" @click="$emit('saveModelConfig')">
            保存运行配置
          </el-button>
        </div>
      </template>

      <el-form label-position="top" class="runtime-config-form">
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
        </div>
      </template>

      <div class="app-preset-layout">
      <el-form label-position="top" :disabled="isSavingAppPreset" @submit.prevent="$emit('saveAppPreset')">
        <el-form-item label="App 名称">
          <el-input v-model="appPresetForm.name" placeholder="例如：示例 App" />
        </el-form-item>
        <el-form-item label="App 包名">
          <el-input v-model="appPresetForm.packageName" placeholder="例如：com.example.app" />
        </el-form-item>
        <div class="app-preset-actions">
          <el-button v-if="appPresetForm.id" :disabled="isSavingAppPreset" @click="$emit('cancelAppPresetEdit')">取消编辑</el-button>
          <el-button type="primary" native-type="submit" :loading="isSavingAppPreset">{{ appPresetForm.id ? '保存修改' : '添加' }}</el-button>
        </div>
      </el-form>

      <div class="app-preset-list">
        <div v-for="app in appPresets" :key="app.id" class="app-preset-row">
          <div class="app-preset-row__main">
            <strong>{{ app.name }}</strong>
            <span>{{ app.packageName }}</span>
          </div>
          <div class="script-row__actions">
            <el-button text size="small" :icon="Edit" :disabled="isSavingAppPreset" :aria-label="`编辑 ${app.name}`" @click="$emit('editAppPreset', app)" />
            <el-button text size="small" :icon="Delete" :disabled="isSavingAppPreset" :aria-label="`删除 ${app.name}`" @click="$emit('deleteAppPreset', app.id)" />
          </div>
        </div>
        <el-empty v-if="!appPresets.length" description="暂无预设 App" />
      </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.runtime-config-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.runtime-config-form :deep(.el-form-item) { margin-bottom: 0; }
@media (max-width: 1000px) { .runtime-config-form { grid-template-columns: minmax(0, 1fr); } }

.app-preset-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.app-preset-actions { display: flex; justify-content: flex-end; margin-top: 4px; }
.app-preset-layout .app-preset-list { margin-top: 0; padding-left: 24px; border-left: 1px solid var(--ui-border); }
@media (max-width: 800px) {
  .app-preset-layout { grid-template-columns: minmax(0, 1fr); }
  .app-preset-layout .app-preset-list { padding: 24px 4px 0 0; border-left: 0; border-top: 1px solid var(--ui-border); }
}
</style>
