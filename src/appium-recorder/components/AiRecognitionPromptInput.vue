<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AiPromptPreset } from '../ai-prompt-presets';
const props = defineProps<{ modelValue: string; presets: readonly AiPromptPreset[]; disabled?: boolean; placeholder?: string }>();
const selectedPreset = computed(() => props.presets.find(preset => preset.prompt === props.modelValue));
const dropdownOpen = ref(false);
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>();
function selectPreset(value: string) {
  const preset = props.presets.find(preset => preset.name === value);
  if (!preset) return;
  emit('update:modelValue', preset.prompt);
  emit('change', preset.prompt);
}
</script>

<template>
  <div class="recognition-prompt-input">
    <el-tooltip :disabled="!selectedPreset || dropdownOpen" :show-after="300" placement="top">
      <template #content><div class="recognition-preset-detail">{{ selectedPreset?.prompt }}</div></template>
    <el-select :model-value="selectedPreset?.name" :disabled="disabled" filterable placeholder="选择测试场景，或在下方输入" aria-label="选择测试场景" @change="selectPreset" @visible-change="dropdownOpen = $event">
      <el-option v-for="preset in presets" :key="preset.name" :label="preset.name" :value="preset.name" class="recognition-preset-option">
        <el-tooltip :show-after="300" placement="right">
          <template #content><div class="recognition-preset-detail">{{ preset.prompt }}</div></template>
          <span class="recognition-preset-name">{{ preset.name }}</span>
        </el-tooltip>
      </el-option>
      <template #empty><div class="recognition-preset-empty">暂无匹配的预设，可在 AI 识别配置中添加</div></template>
    </el-select>
    </el-tooltip>
    <el-input :model-value="modelValue" type="textarea" :rows="3" maxlength="4000" :placeholder="placeholder" :disabled="disabled" @update:model-value="emit('update:modelValue', $event)" @change="emit('change', $event)" />
  </div>
</template>

<style scoped>
.recognition-prompt-input { width: 100%; }
.recognition-prompt-input .el-select { width: 100%; margin-bottom: 10px; }
.recognition-preset-name { display: block; }
.recognition-preset-detail { max-width: min(360px, calc(100vw - 40px)); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
.recognition-preset-option { height: auto; min-height: 34px; white-space: normal; line-height: 1.6; padding-top: 8px; padding-bottom: 8px; overflow-wrap: anywhere; }
.recognition-preset-empty { padding: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
