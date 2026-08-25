<script setup lang="ts">
import AiGeneratorPage from './AiGeneratorPage.vue';
import ManualStepsPage from './ManualStepsPage.vue';
import GeneratedCodePanel from '../components/generator/GeneratedCodePanel.vue';
import type { AppPreset, GeneratorForm, GeneratorMode } from '../types';
import type { ScriptStep } from '../script-generator';

defineProps<{
  form: GeneratorForm;
  appPresets: AppPreset[];
  promptExample: string;
  steps: ScriptStep[];
  generatedCode: string;
  showGeneratedCode: boolean;
  generatedCodeEditing: boolean;
  generatedCodeEditSaving: boolean;
  importingTestCase: boolean;
  importedTestCaseFileName: string;
}>();

const mode = defineModel<GeneratorMode>('mode', { required: true });
const sourcePrompt = defineModel<string>('sourcePrompt', { required: true });
const generatedCodeDraft = defineModel<string>('generatedCodeDraft', { required: true });

defineEmits<{
  addStep: [];
  removeStep: [id: string];
  copyCode: [];
  editCode: [];
  undoCode: [];
  saveCode: [];
  importTestCase: [file: File];
  clearAll: [];
}>();
</script>

<template>
  <div
    class="generator-page"
    :class="{
      'generator-page--ai': mode === 'ai',
      'generator-page--manual': mode === 'manual',
    }"
  >
    <div class="subnav">
      <button
        type="button"
        class="subnav__item"
        :class="{ 'subnav__item--active': mode === 'ai' }"
        @click="mode = 'ai'"
      >
        AI生成
      </button>
      <button
        type="button"
        class="subnav__item"
        :class="{ 'subnav__item--active': mode === 'manual' }"
        @click="mode = 'manual'"
      >
        自定义步骤编排
      </button>
    </div>

    <AiGeneratorPage
      v-if="mode === 'ai'"
      v-model:source-prompt="sourcePrompt"
      :form="form"
      :app-presets="appPresets"
      :prompt-example="promptExample"
      :importing-test-case="importingTestCase"
      :imported-file-name="importedTestCaseFileName"
      @import-test-case="$emit('importTestCase', $event)"
      @clear-all="$emit('clearAll')"
    />

    <ManualStepsPage
      v-else
      :form="form"
      :app-presets="appPresets"
      :steps="steps"
      @add-step="$emit('addStep')"
      @remove-step="$emit('removeStep', $event)"
    />

    <GeneratedCodePanel
      v-model:draft-code="generatedCodeDraft"
      :code="generatedCode"
      :show-code="showGeneratedCode"
      :editing="generatedCodeEditing"
      :saving="generatedCodeEditSaving"
      @copy="$emit('copyCode')"
      @edit="$emit('editCode')"
      @undo="$emit('undoCode')"
      @save="$emit('saveCode')"
    />
  </div>
</template>
