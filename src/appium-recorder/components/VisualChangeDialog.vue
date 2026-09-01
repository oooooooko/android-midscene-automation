<script setup lang="ts">
import { computed } from 'vue';
import { Aim } from '@element-plus/icons-vue';
import type { AppiumVisualChangeConfig } from '../types';
import { normalizeVisualChangeConfig } from '../visual-change';

const props = defineProps<{
  modelValue: boolean;
  config: AppiumVisualChangeConfig;
  hasSelectedElement: boolean;
  pickingRegion?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:config': [value: AppiumVisualChangeConfig];
  pickRegion: [];
  confirm: [];
}>();

const normalizedConfig = computed(() => normalizeVisualChangeConfig(props.config));

function patchConfig(patch: Partial<AppiumVisualChangeConfig>) {
  emit('update:config', normalizeVisualChangeConfig({
    ...normalizedConfig.value,
    ...patch,
  }));
}

function patchRegion(key: keyof AppiumVisualChangeConfig['region'], value: unknown) {
  patchConfig({
    region: {
      ...normalizedConfig.value.region,
      [key]: Number(value),
    },
  });
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="检测画面变化"
    width="480px"
    top="9vh"
    class="appium-visual-change-dialog"
    append-to-body
    draggable
    :modal="false"
    modal-penetrable
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form label-position="top" size="small" class="appium-visual-change-form">
      <el-form-item label="检测目标">
        <el-radio-group
          :model-value="normalizedConfig.mode"
          @update:model-value="patchConfig({ mode: $event as AppiumVisualChangeConfig['mode'] })"
        >
          <el-radio-button label="selectedElement" :disabled="!hasSelectedElement">
            当前选中元素
          </el-radio-button>
          <el-radio-button label="region">手动框选区域</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-alert
        v-if="normalizedConfig.mode === 'selectedElement' && !hasSelectedElement"
        type="warning"
        :closable="false"
        show-icon
        title="当前没有可用的选中元素，请先选择组件或改为手动框选区域"
      />

      <el-form-item v-if="normalizedConfig.mode === 'region'" label="框选区域">
        <el-button :icon="Aim" :loading="pickingRegion" @click="emit('pickRegion')">
          {{ pickingRegion ? '请在设备预览拖拽' : '框选/拖动区域' }}
        </el-button>
      </el-form-item>

      <div class="appium-visual-change-form__grid">
        <el-form-item label="X">
          <el-input-number
            :model-value="normalizedConfig.region.x"
            :min="0"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchRegion('x', $event)"
          />
        </el-form-item>
        <el-form-item label="Y">
          <el-input-number
            :model-value="normalizedConfig.region.y"
            :min="0"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchRegion('y', $event)"
          />
        </el-form-item>
        <el-form-item label="宽度">
          <el-input-number
            :model-value="normalizedConfig.region.width"
            :min="1"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchRegion('width', $event)"
          />
        </el-form-item>
        <el-form-item label="高度">
          <el-input-number
            :model-value="normalizedConfig.region.height"
            :min="1"
            :max="99999"
            :precision="0"
            controls-position="right"
            @update:model-value="patchRegion('height', $event)"
          />
        </el-form-item>
        <el-form-item label="变化阈值 %">
          <el-input-number
            :model-value="normalizedConfig.changeRatioThreshold"
            :min="0.01"
            :max="100"
            :step="0.1"
            controls-position="right"
            @update:model-value="patchConfig({ changeRatioThreshold: Number($event) })"
          />
        </el-form-item>
        <el-form-item label="像素容差">
          <el-input-number
            :model-value="normalizedConfig.pixelmatchThreshold"
            :min="0"
            :max="1"
            :step="0.01"
            controls-position="right"
            @update:model-value="patchConfig({ pixelmatchThreshold: Number($event) })"
          />
        </el-form-item>
      </div>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="emit('confirm')">添加开始节点</el-button>
    </template>
  </el-dialog>
</template>
