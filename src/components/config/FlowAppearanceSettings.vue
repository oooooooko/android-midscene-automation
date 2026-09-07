<script setup lang="ts">
import { computed } from 'vue';
import { RefreshLeft } from '@element-plus/icons-vue';
import { DEFAULT_FLOW_BACKGROUND, FLOW_BACKGROUND_PRESETS, isHexColor, normalizeFlowBackground } from '../../appium-recorder/flow-appearance';

const props = defineProps<{ modelValue?: string; saving: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [color: string]; save: [] }>();
const color = computed(() => props.modelValue ?? DEFAULT_FLOW_BACKGROUND);
const error = computed(() => isHexColor(color.value) ? '' : '请输入有效的十六进制颜色，如 #ABC 或 #AABBCC');
</script>

<template>
  <el-card shadow="never" class="config-module-card config-appium-card flow-appearance-settings">
    <template #header>
      <div class="panel-header">
        <span>流程背景色</span>
        <el-button type="primary" :loading="saving" :disabled="Boolean(error)" @click="emit('save')">保存背景色</el-button>
      </div>
    </template>
    <el-form label-position="top">
      <el-form-item label="预选颜色">
        <div class="flow-color-presets">
          <button v-for="preset in FLOW_BACKGROUND_PRESETS" :key="preset" type="button"
            :style="{ backgroundColor: preset }" :aria-label="`选择颜色 ${preset}`" :title="preset"
            :aria-pressed="normalizeFlowBackground(color) === preset && !error"
            @click="emit('update:modelValue', preset)" />
        </div>
      </el-form-item>
      <el-form-item label="自定义颜色" :error="error">
        <div class="flow-color-input">
          <el-color-picker :model-value="normalizeFlowBackground(color)" color-format="hex" :predefine="FLOW_BACKGROUND_PRESETS"
            aria-label="选择流程背景色" @update:model-value="emit('update:modelValue', $event || DEFAULT_FLOW_BACKGROUND)" />
          <el-input :model-value="color" aria-label="十六进制背景色" placeholder="#D4E8DD"
            @update:model-value="emit('update:modelValue', String($event))" />
          <el-button :icon="RefreshLeft" title="恢复默认颜色" aria-label="恢复默认颜色" @click="emit('update:modelValue', DEFAULT_FLOW_BACKGROUND)" />
        </div>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.flow-appearance-settings { margin-top: 20px; }
.flow-appearance-settings .el-form { max-width: 640px; }
.flow-color-presets, .flow-color-input { display: flex; align-items: center; gap: 10px; }
.flow-color-presets { flex-wrap: wrap; }
.flow-color-presets button { width: 32px; height: 32px; border: 1px solid var(--el-border-color-darker); border-radius: 4px; cursor: pointer; }
.flow-color-presets button[aria-pressed="true"] { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.flow-color-input { width: 100%; }
.flow-color-input .el-input { flex: 1; min-width: 0; }
</style>
