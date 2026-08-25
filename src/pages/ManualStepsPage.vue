<script setup lang="ts">
import { ref } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import {
  createPromptPreset,
  stepTypeDescriptions,
  stepTypeOptions,
  type ScriptStep,
} from '../script-generator';
import type { AppPreset, GeneratorForm } from '../types';

defineProps<{
  form: GeneratorForm;
  appPresets: AppPreset[];
  steps: ScriptStep[];
}>();

defineEmits<{
  addStep: [];
  removeStep: [id: string];
}>();

const stepsDialogVisible = ref(false);
const exampleSteps = createPromptPreset();

const formatRepeatValue = (value: number | string | undefined) => {
  const repeat = Number(value);
  return Number.isFinite(repeat) && repeat > 0 ? String(Math.floor(repeat)) : '';
};

const parseRepeatValue = (value: string) => {
  const repeat = Number(value);
  return Number.isFinite(repeat) && repeat > 0 ? Math.floor(repeat) : 0;
};
</script>

<template>
  <section class="page-grid page-grid--single">
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
  </section>

  <el-card shadow="never" class="manual-steps-card">
    <template #header>
      <span>步骤编排</span>
    </template>

    <details class="method-guide">
      <summary class="method-guide__summary">方法说明</summary>
      <div class="method-guide__content">
        <div v-for="option in stepTypeOptions" :key="option.value" class="method-guide__row">
          <strong>{{ option.label }}</strong>
          <div class="method-guide__text">
            <span>{{ stepTypeDescriptions[option.value].description }}</span>
            <code>{{ stepTypeDescriptions[option.value].example }}</code>
          </div>
        </div>
      </div>
    </details>

    <div class="manual-steps-toolbar">
      <el-button type="primary" plain @click="stepsDialogVisible = true">步骤示例</el-button>
      <el-button type="primary" :icon="Plus" @click="$emit('addStep')">新增步骤</el-button>
    </div>

    <div class="step-list">
      <div v-for="(step, index) in steps" :key="step.id" class="step-item">
        <div class="step-item__top">
          <span class="step-item__index">步骤 {{ index + 1 }}</span>
          <div class="step-item__actions">
            <el-switch v-model="step.enabled" inline-prompt active-text="开" inactive-text="关" />
            <el-button circle :icon="Delete" @click="$emit('removeStep', step.id)" />
          </div>
        </div>
        <el-form label-position="top" class="step-form">
          <div class="step-grid">
            <el-form-item label="方法">
              <el-select v-model="step.type">
                <el-option
                  v-for="option in stepTypeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="步骤标题">
              <el-input v-model="step.label" />
            </el-form-item>
            <el-form-item label="Prompt" class="step-grid__wide">
              <el-input v-model="step.prompt" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item v-if="['act', 'tap'].includes(step.type)" label="重复次数">
              <el-input-number
                v-model="step.repeat"
                :min="0"
                :max="10"
                :formatter="formatRepeatValue"
                :parser="parseRepeatValue"
                placeholder="不重复"
              />
            </el-form-item>
            <el-form-item
              v-if="['query', 'boolean', 'string', 'number'].includes(step.type)"
              label="输出变量"
            >
              <el-input v-model="step.outputVar" />
            </el-form-item>
            <el-form-item v-if="step.type === 'input'" label="输入值">
              <el-input v-model="step.value" />
            </el-form-item>
          </div>
        </el-form>
      </div>
      <el-empty v-if="!steps.length" description="暂无步骤，点击新增步骤开始编排" />
    </div>

    <el-dialog v-model="stepsDialogVisible" title="步骤示例" width="920px" class="steps-dialog">
      <div class="step-list step-list--dialog">
        <div v-for="(step, index) in exampleSteps" :key="step.id" class="step-item step-item--readonly">
          <div class="step-item__top">
            <span class="step-item__index">步骤 {{ index + 1 }}</span>
          </div>
          <el-form label-position="top" class="step-form">
            <div class="step-grid">
              <el-form-item label="方法">
                <el-input
                  :model-value="stepTypeOptions.find((option) => option.value === step.type)?.label || step.type"
                  readonly
                />
              </el-form-item>
              <el-form-item label="步骤标题">
                <el-input :model-value="step.label" readonly />
              </el-form-item>
              <el-form-item label="Prompt" class="step-grid__wide">
                <el-input :model-value="step.prompt" type="textarea" :rows="3" readonly />
              </el-form-item>
              <el-form-item v-if="['act', 'tap'].includes(step.type)" label="重复次数">
                <el-input :model-value="step.repeat && step.repeat > 1 ? String(step.repeat) : '不重复'" readonly />
              </el-form-item>
              <el-form-item
                v-if="['query', 'boolean', 'string', 'number'].includes(step.type)"
                label="输出变量"
              >
                <el-input :model-value="step.outputVar || ''" readonly />
              </el-form-item>
              <el-form-item v-if="step.type === 'input'" label="输入值">
                <el-input :model-value="step.value || ''" readonly />
              </el-form-item>
            </div>
          </el-form>
        </div>
      </div>

      <template #footer>
        <el-button @click="stepsDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
