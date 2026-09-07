<script setup lang="ts">
import { computed } from 'vue';
import type { AppiumRecordedStep } from '../types';
import { longPressMode } from '../long-press';

const props = defineProps<{ step: AppiumRecordedStep; disabled?: boolean }>();
const emit = defineEmits<{ update: [patch: Partial<AppiumRecordedStep>] }>();
const mode = computed(() => longPressMode(props.step));

function changeMode(value: AppiumRecordedStep['longPressMode']) {
  emit('update', {
    longPressMode: value,
    // 旧坐标节点切换到元素模式后，开放定位器输入。
    ...(value === 'element' && (!props.step.selector || props.step.selector.strategy === 'bounds')
      ? { selector: { strategy: 'id' as const, value: '' }, selectorChain: undefined, contextSelector: undefined }
      : {}),
  });
}

function changeCoordinate(key: 'centerX' | 'centerY', value: number | undefined) {
  emit('update', { fallback: { ...props.step.fallback, strategy: 'bounds', [key]: value } });
}
</script>

<template>
  <div>
    <el-form-item label="长按方式">
      <el-radio-group :model-value="mode" :disabled="disabled" @update:model-value="changeMode($event as AppiumRecordedStep['longPressMode'])">
        <el-radio-button value="element">长按元素</el-radio-button>
        <el-radio-button value="coordinates">长按坐标</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <el-form-item label="长按时间 ms">
      <el-input-number
        :model-value="step.timeoutMs ?? 800"
        :disabled="disabled"
        :min="80"
        :max="999999"
        :precision="0"
        controls-position="right"
        @update:model-value="emit('update', { timeoutMs: $event ?? 800 })"
      />
    </el-form-item>
    <div v-if="mode === 'coordinates'" class="appium-flow-editor__grid">
      <el-form-item v-for="axis in (['X', 'Y'] as const)" :key="axis" :label="axis">
        <el-input-number
          :model-value="axis === 'X' ? step.fallback?.centerX : step.fallback?.centerY"
          :disabled="disabled"
          :min="0"
          :max="99999"
          :precision="0"
          controls-position="right"
          @update:model-value="changeCoordinate(axis === 'X' ? 'centerX' : 'centerY', $event)"
        />
      </el-form-item>
    </div>
  </div>
</template>
