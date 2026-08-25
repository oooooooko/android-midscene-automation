<script setup lang="ts">
import { shallowRef } from 'vue';
import { Delete, QuestionFilled } from '@element-plus/icons-vue';
import TestCaseFileUpload from '../components/generator/TestCaseFileUpload.vue';
import type { AppPreset, GeneratorForm } from '../types';

defineProps<{
  form: GeneratorForm;
  appPresets: AppPreset[];
  promptExample: string;
  importingTestCase: boolean;
  importedFileName: string;
}>();

defineEmits<{
  importTestCase: [file: File];
  clearAll: [];
}>();

const sourcePrompt = defineModel<string>('sourcePrompt', { required: true });
const promptExampleVisible = shallowRef(false);
</script>

<template>
  <section class="page-grid">
    <el-card shadow="never">
      <template #header>基础配置</template>
      <el-form label-position="top">
        <el-form-item label="脚本名称">
          <el-input v-model="form.testName" placeholder="请输入脚本名称" />
        </el-form-item>
        <el-form-item label="场景标题">
          <el-input v-model="form.promptTitle" placeholder="请输入场景标题" />
        </el-form-item>
        <el-form-item label="选择 App">
          <el-select v-model="form.appPresetId" placeholder="选择预设 App">
            <el-option
              v-for="app in appPresets"
              :key="app.id"
              :label="`${app.name} · ${app.packageName}`"
              :value="app.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="prompt-card">
      <template #header>
        <div class="panel-header">
          <span>原始 Prompt</span>
          <div class="panel-header__actions prompt-card__actions">
            <TestCaseFileUpload
              :uploading="importingTestCase"
              :file-name="importedFileName"
              @upload="$emit('importTestCase', $event)"
            />
            <el-button size="small" :icon="Delete" :disabled="importingTestCase" @click="$emit('clearAll')">
              清除
            </el-button>
            <el-button
              text
              :icon="QuestionFilled"
              aria-label="查看示例文案"
              @click="promptExampleVisible = true"
            />
          </div>
        </div>
      </template>
      <el-input
        v-model="sourcePrompt"
        class="source-prompt-input"
        type="textarea"
        :rows="14"
        placeholder="请输入原始 Prompt，或点击右上角问号查看示例"
      />
    </el-card>
  </section>

  <el-dialog v-model="promptExampleVisible" title="原始 Prompt 示例" width="720px">
    <pre class="prompt-example"><code>{{ promptExample }}</code></pre>
  </el-dialog>
</template>

<style scoped>
.prompt-card__actions {
  align-items: center;
  min-width: 0;
}
</style>
