<script setup lang="ts">
import { computed } from 'vue';
import { RefreshLeft } from '@element-plus/icons-vue';
import {
  DEFAULT_FLOW_BACKGROUND, FLOW_BACKGROUND_PRESETS, normalizeFlowBackground,
  DEFAULT_FLOW_LINE_COLOR, FLOW_LINE_COLOR_PRESETS, normalizeFlowLineColor, isHexColor,
} from '../../appium-recorder/flow-appearance';

const props = defineProps<{ modelValue?: string; lineColor?: string }>();
const emit = defineEmits<{ 'update:modelValue': [color: string]; 'update:lineColor': [color: string] }>();
const panels = computed(() => [
  { key: 'background' as const, title: '流程背景色', color: props.modelValue ?? DEFAULT_FLOW_BACKGROUND,
    fallback: DEFAULT_FLOW_BACKGROUND, presets: FLOW_BACKGROUND_PRESETS, normalize: normalizeFlowBackground,
    inputLabel: '十六进制背景色', pickerLabel: '选择流程背景色', resetLabel: '恢复默认颜色', presetLabel: '选择颜色' },
  { key: 'line' as const, title: '连接线条颜色', color: props.lineColor ?? DEFAULT_FLOW_LINE_COLOR,
    fallback: DEFAULT_FLOW_LINE_COLOR, presets: FLOW_LINE_COLOR_PRESETS, normalize: normalizeFlowLineColor,
    inputLabel: '十六进制线条颜色', pickerLabel: '选择连接线条颜色', resetLabel: '恢复默认线条颜色', presetLabel: '选择线条颜色' },
].map(panel => ({ ...panel, error: isHexColor(panel.color) ? '' : '请输入有效的十六进制颜色，如 #ABC 或 #AABBCC' })));
function update(key: 'background' | 'line', color: string) {
  if (key === 'background') emit('update:modelValue', color);
  else emit('update:lineColor', color);
}
</script>

<template>
  <el-card shadow="never" class="config-module-card config-appium-card flow-appearance-settings">
    <template #header><div class="panel-header"><span>流程外观</span></div></template>
    <div class="flow-appearance-columns">
      <section v-for="panel in panels" :key="panel.key" class="flow-appearance-section" :aria-label="panel.title">
        <h3>{{ panel.title }}</h3>
        <el-form label-position="top">
          <el-form-item label="预选颜色">
            <div class="flow-color-presets">
              <button v-for="preset in panel.presets" :key="preset" type="button"
                :style="{ backgroundColor: preset }" :aria-label="`${panel.presetLabel} ${preset}`" :title="preset"
                :aria-pressed="panel.normalize(panel.color) === preset && !panel.error"
                @click="update(panel.key, preset)" />
            </div>
          </el-form-item>
          <el-form-item label="自定义颜色" :error="panel.error">
            <div class="flow-color-input">
              <el-color-picker :model-value="panel.normalize(panel.color)" color-format="hex" :predefine="panel.presets"
                :aria-label="panel.pickerLabel" @update:model-value="update(panel.key, $event || panel.fallback)" />
              <el-input :model-value="panel.color" :aria-label="panel.inputLabel" :placeholder="panel.fallback"
                @update:model-value="update(panel.key, String($event))" />
              <el-button :icon="RefreshLeft" :title="panel.resetLabel" :aria-label="panel.resetLabel" @click="update(panel.key, panel.fallback)" />
            </div>
          </el-form-item>
        </el-form>
      </section>
    </div>
  </el-card>
</template>

<style scoped>
.flow-appearance-settings { margin-top: 20px; }
.flow-appearance-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; }
.flow-appearance-section { min-width: 0; }
.flow-appearance-section + .flow-appearance-section { padding-left: 32px; border-left: 1px solid var(--ui-border); }
.flow-appearance-section h3 { margin: 0 0 20px; font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); }
.flow-color-presets, .flow-color-input { display: flex; align-items: center; gap: 10px; }
.flow-color-presets { flex-wrap: wrap; }
.flow-color-presets button { width: 32px; height: 32px; border: 1px solid var(--el-border-color-darker); border-radius: 4px; cursor: pointer; }
.flow-color-presets button[aria-pressed="true"] { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.flow-color-input { width: 100%; }
.flow-color-input .el-input { flex: 1; min-width: 0; }
@media (max-width: 800px) {
  .flow-appearance-columns { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .flow-appearance-section + .flow-appearance-section { padding: 24px 0 0; border-left: 0; border-top: 1px solid var(--ui-border); }
}
</style>
