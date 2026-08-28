<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue';
import { ElMessage } from 'element-plus';
import { Delete, Edit, QuestionFilled, Upload } from '@element-plus/icons-vue';
import TestCaseFileUpload from '../components/generator/TestCaseFileUpload.vue';
import type { AppPreset, GeneratorForm } from '../types';
import type { PromptPreset } from '../config/prompt-presets';

const props = defineProps<{
  form: GeneratorForm;
  appPresets: AppPreset[];
  promptPresets: PromptPreset[];
  promptExample: string;
  generating: boolean;
  importingTestCase: boolean;
  importedFileName: string;
}>();

defineEmits<{
  importTestCase: [file: File];
  clearAll: [];
}>();

const sourcePrompt = defineModel<string>('sourcePrompt', { required: true });
const promptPresetId = defineModel<string>('promptPresetId', { required: true });
const promptExampleVisible = shallowRef(false);
const promptEditorVisible = shallowRef(false);
const promptEditorDraft = shallowRef('');
const promptFileInput = useTemplateRef<HTMLInputElement>('promptFileInput');

const applyPromptPreset = (id: string) => {
  const preset = props.promptPresets.find((item) => item.id === id);
  if (!preset) return;
  sourcePrompt.value = preset.content;
};

const openPromptEditor = () => {
  promptEditorDraft.value = sourcePrompt.value;
  promptEditorVisible.value = true;
};

const savePromptEditor = () => {
  sourcePrompt.value = promptEditorDraft.value.trim();
  promptEditorVisible.value = false;
};

const openPromptFilePicker = () => {
  promptFileInput.value?.click();
};

const handlePromptFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const content = (await file.text()).trim();
    if (!content) {
      ElMessage.warning('上传的提示词为空');
      return;
    }
    sourcePrompt.value = content;
    ElMessage.success('提示词已上传');
  } catch {
    ElMessage.error('提示词文件读取失败');
  } finally {
    input.value = '';
  }
};
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
        <el-form-item label="提示词模板">
          <div class="prompt-template-row">
            <el-select
              v-model="promptPresetId"
              placeholder="选择提示词模板"
              popper-class="prompt-template-dropdown"
              :disabled="generating"
              @change="applyPromptPreset"
            >
              <el-option
                v-for="preset in promptPresets"
                :key="preset.id"
                :label="preset.name"
                :value="preset.id"
              >
                <div class="prompt-template-option">
                  <span class="prompt-template-option__name">{{ preset.name }}</span>
                  <span class="prompt-template-option__description">{{ preset.description }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="prompt-template-actions">
              <el-button size="small" :icon="Edit" :disabled="generating" @click="openPromptEditor">
                编辑
              </el-button>
              <el-button size="small" :icon="Upload" :disabled="generating" @click="openPromptFilePicker">
                上传
              </el-button>
            </div>
            <input
              ref="promptFileInput"
              class="prompt-file-input"
              type="file"
              accept=".txt,.md,.markdown,.text"
              @change="handlePromptFileChange"
            />
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="prompt-card">
      <template #header>
        <div class="panel-header">
          <span>原始 Prompt</span>
          <div class="panel-header__actions prompt-card__actions">
            <TestCaseFileUpload
              :uploading="importingTestCase || generating"
              :file-name="importedFileName"
              @upload="$emit('importTestCase', $event)"
            />
            <el-button
              size="small"
              :icon="Delete"
              :disabled="importingTestCase || generating"
              @click="$emit('clearAll')"
            >
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
        :disabled="generating"
        placeholder="请输入原始 Prompt，或点击右上角问号查看示例"
      />
    </el-card>
  </section>

  <el-dialog v-model="promptExampleVisible" title="原始 Prompt 示例" width="720px">
    <pre class="prompt-example"><code>{{ promptExample }}</code></pre>
  </el-dialog>

  <el-dialog v-model="promptEditorVisible" title="编辑提示词" width="760px">
    <el-input
      v-model="promptEditorDraft"
      class="prompt-editor-input"
      type="textarea"
      :rows="18"
      :disabled="generating"
      placeholder="请输入提示词"
    />
    <template #footer>
      <el-button @click="promptEditorVisible = false">取消</el-button>
      <el-button type="primary" :disabled="generating" @click="savePromptEditor">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.prompt-template-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.prompt-template-row .el-select {
  flex: 1 1 auto;
  min-width: 0;
}

.prompt-template-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.prompt-template-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  line-height: 1.35;
}

.prompt-template-option__name {
  color: #1f2937;
  font-weight: 600;
}

.prompt-template-option__description {
  color: #8a97a8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-file-input {
  display: none;
}

:global(.prompt-template-dropdown .el-select-dropdown__list) {
  padding: 6px;
}

:global(.prompt-template-dropdown .el-select-dropdown__item) {
  height: auto;
  min-height: 64px;
  padding: 11px 12px;
  border-radius: 6px;
  line-height: 1.35;
  white-space: normal;
}

:global(.prompt-template-dropdown .el-select-dropdown__item + .el-select-dropdown__item) {
  margin-top: 4px;
}

.prompt-card__actions {
  align-items: center;
  min-width: 0;
}

.prompt-editor-input :deep(.el-textarea__inner) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  line-height: 1.6;
}

@media (max-width: 640px) {
  .prompt-template-row {
    align-items: stretch;
    flex-direction: column;
  }

  .prompt-template-actions {
    justify-content: flex-end;
  }
}
</style>
