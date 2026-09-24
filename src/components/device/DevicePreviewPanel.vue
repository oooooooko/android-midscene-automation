<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Close, Cpu, FullScreen, Refresh } from '@element-plus/icons-vue';
import type { AndroidDevice, DeviceAction } from '../../types';
import DeviceInfoTooltip from './DeviceInfoTooltip.vue';

type DeviceOverlayBounds = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type DeviceRegionSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
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
  selectedRegion?: DeviceOverlayBounds;
  regionSelection?: boolean;
  pointSelection?: boolean;
  regionDrawMode?: boolean;
  deviceWidth?: number;
  deviceHeight?: number;
  compact?: boolean;
  interactionDisabled?: boolean;
}>();

const emit = defineEmits<{
  switchDevice: [deviceId: string];
  triggerKey: [keyCode: number];
  previewLoaded: [size: { width: number; height: number }];
  previewError: [];
  refreshPreview: [];
  tap: [point: { x: number; y: number }];
  cancelPointSelection: [];
  regionSelect: [region: DeviceRegionSelection];
  swipe: [gesture: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    duration: number;
  }];
}>();

const imageSize = shallowRef({ width: 0, height: 0 });
const previewRef = ref<HTMLElement>();
const previewSize = ref({ width: 0, height: 0 });
const enlarged = ref(false);
let observer: ResizeObserver | undefined;
function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') enlarged.value = false; }
onMounted(() => {
  if (!props.compact) return;
  observer = new ResizeObserver(([entry]) => {
    if (entry) previewSize.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  if (previewRef.value) observer.observe(previewRef.value);
  window.addEventListener('keydown', closeOnEscape);
});
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('keydown', closeOnEscape); });
let pointerSession: {
  mode: 'gesture' | 'region-draw' | 'region-move';
  pointerId: number;
  start: { x: number; y: number };
  startClientX: number;
  startClientY: number;
  origin?: DeviceOverlayBounds;
} | null = null;
const draftRegion = shallowRef<DeviceOverlayBounds | null>(null);
const hasPreview = computed(() => Boolean(props.frameUrl || props.imageUrl));
const imageBoxStyle = computed(() => {
  const width = props.deviceWidth || imageSize.value.width;
  const height = props.deviceHeight || imageSize.value.height;
  if (props.compact) {
    const ratio = width && height ? width / height : 9 / 20;
    const fittedWidth = Math.min(previewSize.value.width, previewSize.value.height * ratio);
    return { width: `${fittedWidth}px`, height: `${fittedWidth / ratio}px` };
  }
  if (props.frameUrl) return {};
  return { aspectRatio: width && height ? `${width} / ${height}` : '9 / 20' };
});
const overlayViewBox = computed(() => {
  const width = props.deviceWidth || imageSize.value.width;
  const height = props.deviceHeight || imageSize.value.height;
  return width && height ? `0 0 ${width} ${height}` : '';
});

watch(() => props.regionSelection, (enabled) => {
  if (enabled) return;
  pointerSession = null;
  draftRegion.value = null;
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

function boundsFromPoints(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return {
    id,
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

function pointInBounds(point: { x: number; y: number }, bounds?: DeviceOverlayBounds) {
  if (!bounds) return false;
  return point.x >= bounds.left
    && point.x <= bounds.right
    && point.y >= bounds.top
    && point.y <= bounds.bottom;
}

function clampRegion(bounds: DeviceOverlayBounds) {
  const width = props.deviceWidth || imageSize.value.width;
  const height = props.deviceHeight || imageSize.value.height;
  const regionWidth = Math.max(1, bounds.right - bounds.left);
  const regionHeight = Math.max(1, bounds.bottom - bounds.top);
  const left = Math.max(0, Math.min(bounds.left, Math.max(0, width - regionWidth)));
  const top = Math.max(0, Math.min(bounds.top, Math.max(0, height - regionHeight)));
  return {
    id: bounds.id,
    left,
    top,
    right: left + regionWidth,
    bottom: top + regionHeight,
  };
}

function moveBounds(
  origin: DeviceOverlayBounds,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return clampRegion({
    id: origin.id,
    left: origin.left + dx,
    top: origin.top + dy,
    right: origin.right + dx,
    bottom: origin.bottom + dy,
  });
}

function emitRegion(bounds: DeviceOverlayBounds) {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (width < 2 || height < 2) return;
  emit('regionSelect', {
    x: bounds.left,
    y: bounds.top,
    width,
    height,
  });
}

function handlePointerDown(event: PointerEvent) {
  if (props.interactionDisabled && !props.regionSelection) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const target = event.currentTarget as HTMLElement;
  const point = getDevicePoint(target, event.clientX, event.clientY);
  if (!point) return;
  if (props.regionSelection) {
    event.preventDefault();
    event.stopPropagation();
  }
  target.setPointerCapture(event.pointerId);
  const isMovingRegion = props.regionSelection
    && !props.regionDrawMode
    && pointInBounds(point, props.selectedRegion);
  pointerSession = {
    mode: props.regionSelection ? (isMovingRegion ? 'region-move' : 'region-draw') : 'gesture',
    pointerId: event.pointerId,
    start: point,
    startClientX: event.clientX,
    startClientY: event.clientY,
    origin: isMovingRegion && props.selectedRegion ? { ...props.selectedRegion } : undefined,
  };
  if (props.regionSelection) {
    draftRegion.value = pointerSession.origin || boundsFromPoints('draft-region', point, point);
  }
}

function handlePointerMove(event: PointerEvent) {
  if (!pointerSession || pointerSession.pointerId !== event.pointerId || pointerSession.mode === 'gesture') return;
  const target = event.currentTarget as HTMLElement;
  const point = getDevicePoint(target, event.clientX, event.clientY);
  if (!point) return;
  event.preventDefault();
  if (pointerSession.mode === 'region-move' && pointerSession.origin) {
    draftRegion.value = moveBounds(pointerSession.origin, pointerSession.start, point);
    return;
  }
  draftRegion.value = boundsFromPoints('draft-region', pointerSession.start, point);
}

function handlePointerUp(event: PointerEvent) {
  if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
  const target = event.currentTarget as HTMLElement;
  const point = getDevicePoint(target, event.clientX, event.clientY);
  const session = pointerSession;
  pointerSession = null;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  if (!point) {
    if (session.mode !== 'gesture') draftRegion.value = null;
    return;
  }

  if (props.pointSelection) {
    if (!props.interactionDisabled) emit('tap', {
      x: Math.min(point.x, (props.deviceWidth || imageSize.value.width) - 1),
      y: Math.min(point.y, (props.deviceHeight || imageSize.value.height) - 1),
    });
    return;
  }

  if (session.mode !== 'gesture') {
    const bounds = draftRegion.value || boundsFromPoints('selected-region', session.start, point);
    draftRegion.value = null;
    emitRegion(bounds);
    return;
  }

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
  if (pointerSession?.pointerId === event.pointerId) {
    pointerSession = null;
    draftRegion.value = null;
  }
}
</script>

<template>
  <el-card shadow="never" class="automation-card device-preview-card" :class="{ 'device-preview-card--compact': compact, 'device-preview-card--enlarged': enlarged }">
    <template #header>
      <div class="panel-header">
        <div class="device-preview-title"><span>设备预览</span><DeviceInfoTooltip :device-id="selectedDeviceId" /></div>
        <div class="device-status">
          <el-tag v-if="compact" :type="available ? 'success' : 'info'">
            {{ available ? '已连接' : '未连接' }}
          </el-tag>
          <el-tooltip v-if="compact && !pointSelection" :content="enlarged ? '退出设备放大' : '放大设备预览'" placement="top" :show-after="200"><el-button class="recorder-panel-tool" size="small" :icon="enlarged ? Close : FullScreen" :aria-label="enlarged ? '退出设备放大' : '放大设备预览'" @click="enlarged = !enlarged" /></el-tooltip>
          <el-tooltip content="刷新画面" placement="top" :show-after="200">
          <el-button
            :text="!compact"
            :circle="!compact"
            :class="{ 'recorder-panel-tool': compact }"
            :size="compact ? 'small' : 'default'"
            :icon="Refresh"
            :disabled="!selectedDeviceId"
            aria-label="刷新画面"
            @click="emit('refreshPreview')"
          />
          </el-tooltip>
          <el-tag v-if="!compact" :type="available ? 'success' : 'info'">{{ available ? 'ADB 已连接' : '未检测到设备' }}</el-tag>
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
        :disabled="interactionDisabled || regionSelection || pointSelection"
        :aria-label="action.label"
        @click="emit('triggerKey', action.keyCode)"
      >
        <img :src="action.icon" :alt="action.label" class="device-action-button__icon" />
        <span class="device-action-button__tooltip">{{ action.label }}</span>
      </button>
    </div>

    <div v-if="pointSelection" class="device-point-selection">
      <span>请点击画面获取坐标</span>
      <el-button size="small" text @click="emit('cancelPointSelection')">取消取点</el-button>
    </div>
    <div
      ref="previewRef"
      class="device-preview"
      :class="{
        'device-preview--image': imageUrl && !frameUrl,
        'device-preview--empty': !hasPreview,
      }"
    >
      <div
        v-if="hasPreview"
        class="device-preview__interactive"
        :class="{ 'device-preview__interactive--image': !frameUrl }"
        :style="imageBoxStyle"
      >
        <div
          class="device-preview__surface"
          :class="{ 'device-preview__surface--selecting': regionSelection || pointSelection }"
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
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
          v-if="overlayViewBox && (overlayBounds?.length || selectedBounds || selectedRegion || draftRegion)"
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
          <rect
            v-if="selectedRegion && !draftRegion"
            class="device-preview__selected-region"
            :x="selectedRegion.left"
            :y="selectedRegion.top"
            :width="Math.max(0, selectedRegion.right - selectedRegion.left)"
            :height="Math.max(0, selectedRegion.bottom - selectedRegion.top)"
            vector-effect="non-scaling-stroke"
          />
          <rect
            v-if="draftRegion"
            class="device-preview__draft-region"
            :x="draftRegion.left"
            :y="draftRegion.top"
            :width="Math.max(0, draftRegion.right - draftRegion.left)"
            :height="Math.max(0, draftRegion.bottom - draftRegion.top)"
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

<style scoped>
.device-point-selection { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 12px; color: var(--el-color-primary); }
.device-preview-title { display: flex; align-items: center; gap: 8px; }
.device-preview-card--compact { display: flex; flex-direction: column; min-height: 0; }
.device-preview-card--compact :deep(> .el-card__body) { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; gap: 8px; }
.device-preview-card--compact .panel-header { flex-wrap: wrap; gap: 8px; font-size: 14px; }
.device-preview-card--compact .device-status { gap: 8px; margin-left: auto; }
.device-preview-card--compact .device-status .el-tag { font-size: 11px; padding: 0 4px; }
.device-preview-card--compact .device-toolbar, .device-preview-card--compact .device-actions { flex: none; margin: 0; }
.device-preview-card--compact .device-toolbar { display: flex; padding: 0; }
.device-preview-card--compact .device-select { width: 100%; min-width: 0; }
.device-preview-card--compact .device-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; padding: 0; }
.device-preview-card--compact .device-actions::before { display: none; }
.device-preview-card--compact .device-action-button { margin: 0; width: 30px; height: 30px; }
.device-preview-card--compact .device-action-button:disabled { opacity: .45; cursor: not-allowed; }
.device-preview-card--compact .device-preview { flex: 1; height: auto; min-height: 0; }
.device-preview-card--compact .device-preview__empty { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; }
.device-preview-card--compact.device-preview-card--enlarged { position: fixed; inset: 24px; z-index: 2100; margin: 0; box-shadow: 0 0 0 100vmax #0007; }
.device-preview-card--enlarged :deep(.el-card__header) { padding-right: 12px; }
.device-preview-card--enlarged .device-toolbar { max-width: 420px; align-self: center; width: 100%; }
@media (max-width: 600px) { .device-preview-card--compact.device-preview-card--enlarged { inset: 12px; } }
</style>
