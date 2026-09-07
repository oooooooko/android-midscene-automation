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
  </div>
</template>
