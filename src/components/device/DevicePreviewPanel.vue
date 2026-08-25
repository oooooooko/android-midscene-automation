<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { Cpu, Refresh } from '@element-plus/icons-vue';
import type { AndroidDevice, DeviceAction } from '../../types';

type DeviceOverlayBounds = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const props = defineProps<{
  available: boolean;
  devices: AndroidDevice[];
  selectedDeviceId: string;
  frameUrl?: string;
  imageUrl?: string;
  previewError?: string;
  actions?: readonly DeviceAction[];
  overlayBounds?: readonly DeviceOverlayBounds[];
  selectedBounds?: DeviceOverlayBounds;
  deviceWidth?: number;
  deviceHeight?: number;
}>();

const emit = defineEmits<{
  switchDevice: [deviceId: string];
  triggerKey: [keyCode: number];
  previewLoaded: [size: { width: number; height: number }];
  previewError: [];
  refreshPreview: [];
  tap: [point: { x: number; y: number }];
  swipe: [gesture: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    duration: number;
  }];
}>();

const imageSize = shallowRef({ width: 0, height: 0 });
let pointerSession: {
  pointerId: number;
  start: { x: number; y: number };
  startClientX: number;
  startClientY: number;
} | null = null;
const hasPreview = computed(() => Boolean(props.frameUrl || props.imageUrl));
const imageBoxStyle = computed(() => {
  if (props.frameUrl) return {};
  const width = props.deviceWidth || imageSize.value.width;
  const height = props.deviceHeight || imageSize.value.height;
  return { aspectRatio: width && height ? `${width} / ${height}` : '9 / 20' };
});
const overlayViewBox = computed(() => {
  const width = props.deviceWidth || imageSize.value.width;
  const height = props.deviceHeight || imageSize.value.height;
  return width && height ? `0 0 ${width} ${height}` : '';
});

function updateImageSize(event: Event) {
  const image = event.target as HTMLImageElement;
  imageSize.value = { width: image.naturalWidth, height: image.naturalHeight };
  emit('previewLoaded', imageSize.value);
}

function getDevicePoint(target: HTMLElement, clientX: number, clientY: number) {
  const width = props.deviceWidth || imageSize.value.width;
  const height = props.deviceHeight || imageSize.value.height;
  if (!width || !height) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const deviceAspect = width / height;
  const containerAspect = rect.width / rect.height;
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (containerAspect > deviceAspect) {
    drawWidth = rect.height * deviceAspect;
    offsetX = (rect.width - drawWidth) / 2;
  } else {
    drawHeight = rect.width / deviceAspect;
    offsetY = (rect.height - drawHeight) / 2;
  }

  const localX = Math.max(0, Math.min(drawWidth, clientX - rect.left - offsetX));
  const localY = Math.max(0, Math.min(drawHeight, clientY - rect.top - offsetY));
  return {
    x: Math.round((localX / drawWidth) * width),
    y: Math.round((localY / drawHeight) * height),
  };
}

function handlePointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const target = event.currentTarget as HTMLElement;
  const point = getDevicePoint(target, event.clientX, event.clientY);
  if (!point) return;
  target.setPointerCapture(event.pointerId);
  pointerSession = {
    pointerId: event.pointerId,
    start: point,
    startClientX: event.clientX,
    startClientY: event.clientY,
  };
}

function handlePointerUp(event: PointerEvent) {
  if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
  const target = event.currentTarget as HTMLElement;
  const point = getDevicePoint(target, event.clientX, event.clientY);
  const session = pointerSession;
  pointerSession = null;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  if (!point) return;

  const moved = Math.hypot(
    event.clientX - session.startClientX,
    event.clientY - session.startClientY,
  );
  if (moved < 8) {
    emit('tap', session.start);
    return;
  }

  emit('swipe', {
    startX: session.start.x,
    startY: session.start.y,
    endX: point.x,
    endY: point.y,
    duration: 120,
  });
}

function handlePointerCancel(event: PointerEvent) {
  if (pointerSession?.pointerId === event.pointerId) pointerSession = null;
}
</script>

<template>
  <el-card shadow="never" class="automation-card device-preview-card">
    <template #header>
      <div class="panel-header">
        <span>设备预览</span>
        <div class="device-status">
          <el-button
            text
            circle
            :icon="Refresh"
            :disabled="!selectedDeviceId"
            title="刷新画面"
            @click="emit('refreshPreview')"
          />
          <el-tag :type="available ? 'success' : 'info'">
            {{ available ? 'ADB 已连接' : '未检测到设备' }}
          </el-tag>
        </div>
      </div>
    </template>

    <div class="device-toolbar">
      <el-select
        :model-value="selectedDeviceId"
        placeholder="选择设备"
        class="device-select"
        @change="emit('switchDevice', String($event))"
      >
        <el-option
          v-for="device in devices"
          :key="device.id"
          :label="`${device.id}${device.description ? ` · ${device.description}` : ''}`"
          :value="device.id"
        />
      </el-select>
    </div>

    <div v-if="actions?.length" class="device-actions">
      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        class="device-action-button"
        @click="emit('triggerKey', action.keyCode)"
      >
        <img :src="action.icon" :alt="action.label" class="device-action-button__icon" />
        <span class="device-action-button__tooltip">{{ action.label }}</span>
      </button>
    </div>

    <div
      class="device-preview"
      :class="{ 'device-preview--image': imageUrl && !frameUrl }"
    >
      <div
        v-if="hasPreview"
        class="device-preview__interactive"
        :class="{ 'device-preview__interactive--image': !frameUrl }"
        :style="imageBoxStyle"
      >
        <div
          class="device-preview__surface"
          @pointerdown="handlePointerDown"
          @pointerup="handlePointerUp"
          @pointercancel="handlePointerCancel"
        />
        <iframe
          v-if="frameUrl"
          :key="frameUrl"
          :src="frameUrl"
          title="Android Device Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
          class="device-preview__frame"
        />
        <img
          v-else
          :src="imageUrl"
          alt="Android Device Preview"
          class="device-preview__frame device-preview__image"
          @load="updateImageSize"
          @error="emit('previewError')"
        />
        <svg
          v-if="overlayViewBox && (overlayBounds?.length || selectedBounds)"
          class="device-preview__overlay"
          :viewBox="overlayViewBox"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <rect
            v-for="bounds in overlayBounds"
            :key="bounds.id"
            class="device-preview__node-bound"
            :x="bounds.left"
            :y="bounds.top"
            :width="Math.max(0, bounds.right - bounds.left)"
            :height="Math.max(0, bounds.bottom - bounds.top)"
            vector-effect="non-scaling-stroke"
          />
          <rect
            v-if="selectedBounds"
            class="device-preview__selected-bound"
            :x="selectedBounds.left"
            :y="selectedBounds.top"
            :width="Math.max(0, selectedBounds.right - selectedBounds.left)"
            :height="Math.max(0, selectedBounds.bottom - selectedBounds.top)"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div v-else class="device-preview__empty">
        <Cpu class="device-preview__icon" />
        <p v-if="selectedDeviceId" class="device-preview__meta">
          当前设备：{{ selectedDeviceId }}
        </p>
        <p v-if="previewError">{{ previewError }}</p>
        <p v-else>请选择可用设备</p>
      </div>
    </div>
  </el-card>
</template>
