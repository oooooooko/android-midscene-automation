<script setup lang="ts">
import { computed, inject, onBeforeUnmount, watch } from 'vue';
import { Aim } from '@element-plus/icons-vue';
import { coordinatePreviewKey } from '../coordinate-preview';

const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ select: [point: { x: number; y: number }] }>();
const picker = inject(coordinatePreviewKey, undefined);
const owner = Symbol('coordinate-editor');
const picking = computed(() => picker?.owner.value === owner);
function cancel() { picker?.cancel(owner); }
watch(() => props.disabled, (disabled) => { if (disabled) cancel(); });
onBeforeUnmount(cancel);
</script>

<template>
  <el-form-item>
    <el-button :icon="Aim" :disabled="disabled || !picker?.enabled.value" @click="picker?.start(owner, point => emit('select', point))">
      {{ picking ? '请在左侧设备预览点击' : '获取点击坐标' }}
    </el-button>
    <el-button v-if="picking" text @click="cancel">取消取点</el-button>
  </el-form-item>
</template>
