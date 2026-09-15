<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { RefreshLeft, Fold, Operation } from '@element-plus/icons-vue';

const STORAGE_KEY = 'android-midscene-automation:recorder-layout';
const defaults = { previewWidth: null as number | null, treeWidth: null as number | null, previewHidden: false, treeHidden: false, mode: 'recording' };
const settings = reactive({ ...defaults });
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved) {
    for (const key of ['previewWidth', 'treeWidth'] as const) {
      if (Number.isFinite(saved[key])) settings[key] = Math.max(key === 'previewWidth' ? 260 : 220, Math.min(600, saved[key]));
    }
    // The previous fixed defaults should follow the restored proportional layout.
    if (saved.previewWidth === 320 && saved.treeWidth === 260) {
      settings.previewWidth = null;
      settings.treeWidth = null;
    }
    settings.previewHidden = saved.previewHidden === true;
    settings.treeHidden = saved.treeHidden === true;
    settings.mode = saved.mode === 'flow' ? 'flow' : 'recording';
  }
} catch { /* Layout persistence is optional when browser storage is unavailable. */ }
watch(settings, () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Keep the layout usable without storage. */ }
});

const container = ref<HTMLElement>();
const width = ref(1400);
const drawer = ref<'preview' | 'tree' | null>(null);
const narrow = computed(() => width.value < 700);
const treeCollapsed = computed(() => settings.treeHidden || settings.mode === 'flow' || width.value < 1100);
const previewCollapsed = computed(() => settings.previewHidden || narrow.value);
watch(() => width.value < 1100 ? (narrow.value ? 'small' : 'medium') : 'wide', () => { drawer.value = null; });
// Match the original 2.8fr / 3fr / 4.2fr columns, including the preview's 320px minimum.
const defaultPreviewWidth = computed(() => Math.max(320, (width.value - 16) * .28));
const defaultTreeWidth = computed(() => (width.value - 16 - defaultPreviewWidth.value) * 3 / 7.2);
const previewWidth = computed(() => Math.max(260, Math.min(settings.previewWidth ?? defaultPreviewWidth.value, width.value - 440 - (treeCollapsed.value ? 36 : 220) - 16)));
const treeWidth = computed(() => Math.max(220, Math.min(settings.treeWidth ?? defaultTreeWidth.value, width.value - 440 - (previewCollapsed.value ? 36 : previewWidth.value) - 16)));
const columns = computed(() => `${previewCollapsed.value ? 36 : previewWidth.value}px 8px ${treeCollapsed.value ? 36 : treeWidth.value}px 8px minmax(0, 1fr)`);

function showTree() {
  if (width.value < 1100) drawer.value = 'tree';
  else { settings.mode = 'recording'; settings.treeHidden = false; }
}
function showPreview() {
  if (narrow.value) drawer.value = 'preview';
  else settings.previewHidden = false;
}
function setMode(mode: string | number | boolean | undefined) {
  settings.mode = mode === 'flow' ? 'flow' : 'recording';
  drawer.value = null;
  if (settings.mode === 'recording') { settings.treeHidden = false; settings.previewHidden = false; }
}
function resetLayout() { Object.assign(settings, defaults); drawer.value = null; }

let drag: { key: 'previewWidth' | 'treeWidth'; startX: number; startWidth: number; pointerId: number } | null = null;
function beginResize(event: PointerEvent, key: 'previewWidth' | 'treeWidth') {
  if (event.button !== 0) return;
  drag = { key, startX: event.clientX, startWidth: key === 'previewWidth' ? previewWidth.value : treeWidth.value, pointerId: event.pointerId };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function changeWidth(key: 'previewWidth' | 'treeWidth', value: number) {
  const other = key === 'previewWidth' ? (treeCollapsed.value ? 36 : treeWidth.value) : (previewCollapsed.value ? 36 : previewWidth.value);
  settings[key] = Math.max(key === 'previewWidth' ? 260 : 220, Math.min(600, width.value - other - 456, value));
}
function resize(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) changeWidth(drag.key, drag.startWidth + event.clientX - drag.startX);
}
function resizeKey(event: KeyboardEvent, key: 'previewWidth' | 'treeWidth') {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  changeWidth(key, (key === 'previewWidth' ? previewWidth.value : treeWidth.value) + (event.key === 'ArrowRight' ? 20 : -20));
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { if (entry) width.value = entry.contentRect.width; });
  if (container.value) observer.observe(container.value);
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ showTree, showPreview });
</script>

<template>
  <div ref="container" class="recorder-workspace">
    <div class="recorder-workspace__toolbar">
      <el-radio-group :model-value="settings.mode" size="small" aria-label="工作区布局" @update:model-value="setMode">
        <el-radio-button value="recording">录制布局</el-radio-button>
        <el-radio-button value="flow">流程布局</el-radio-button>
      </el-radio-group>
      <div class="recorder-workspace__tools">
        <el-tooltip content="恢复默认布局" placement="top"><el-button :icon="RefreshLeft" size="small" aria-label="恢复默认布局" @click="resetLayout" /></el-tooltip>
      </div>
    </div>
    <div class="recorder-workspace__panels" :style="{ gridTemplateColumns: columns }">
      <div v-show="!previewCollapsed || drawer === 'preview'" class="recorder-workspace__panel" :class="{ 'recorder-workspace__panel--drawer': drawer === 'preview' }">
        <slot name="preview" />
        <el-tooltip content="收起设备预览" placement="top" :show-after="200"><el-button class="recorder-workspace__collapse recorder-panel-tool" :icon="Fold" size="small" aria-label="收起设备预览" @click="settings.previewHidden = true; drawer = null" /></el-tooltip>
      </div>
      <button v-if="previewCollapsed" class="recorder-workspace__rail" aria-label="展开设备预览" title="展开设备预览" @click="showPreview"><el-icon><Operation /></el-icon><span>设备预览</span></button>
      <div class="recorder-workspace__separator" :class="{ 'is-disabled': previewCollapsed }" role="separator" aria-label="调整设备预览宽度" aria-orientation="vertical" :aria-valuenow="previewWidth" :tabindex="previewCollapsed ? -1 : 0" @pointerdown="!previewCollapsed && beginResize($event, 'previewWidth')" @pointermove="resize" @pointerup="drag = null" @pointercancel="drag = null" @keydown="resizeKey($event, 'previewWidth')" />
      <div v-show="!treeCollapsed || drawer === 'tree'" class="recorder-workspace__panel" :class="{ 'recorder-workspace__panel--drawer': drawer === 'tree' }">
        <slot name="tree" />
        <el-tooltip content="收起组件树" placement="top" :show-after="200"><el-button class="recorder-workspace__collapse recorder-panel-tool" :icon="Fold" size="small" aria-label="收起组件树" @click="settings.treeHidden = true; drawer = null" /></el-tooltip>
      </div>
      <button v-if="treeCollapsed" class="recorder-workspace__rail" aria-label="展开组件树" title="展开组件树" @click="showTree"><el-icon><Operation /></el-icon><span>组件树</span></button>
      <div class="recorder-workspace__separator" :class="{ 'is-disabled': treeCollapsed }" role="separator" aria-label="调整组件树宽度" aria-orientation="vertical" :aria-valuenow="treeWidth" :tabindex="treeCollapsed ? -1 : 0" @pointerdown="!treeCollapsed && beginResize($event, 'treeWidth')" @pointermove="resize" @pointerup="drag = null" @pointercancel="drag = null" @keydown="resizeKey($event, 'treeWidth')" />
      <div class="recorder-workspace__main"><slot /></div>
      <button v-if="drawer" class="recorder-workspace__backdrop" aria-label="关闭侧面板" @click="drawer = null" />
    </div>
  </div>
</template>

<style scoped>
.recorder-workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; gap: 8px; }
.recorder-workspace__toolbar { display: flex; align-items: center; flex: none; gap: 8px; }
.recorder-workspace__tools { display: flex; }
.recorder-workspace__tools .el-button { width: 24px; height: 24px; min-height: 24px; padding: 0; font-size: 12px; border-radius: 4px; }
.recorder-workspace__panels { display: grid; position: relative; flex: 1; min-height: 0; }
.recorder-workspace__panel, .recorder-workspace__main { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.recorder-workspace__panel :deep(> .el-card), .recorder-workspace__main :deep(> .el-card) { flex: 1; min-width: 0; min-height: 0; }
.recorder-workspace__panel :deep(.el-card__header) { padding: 12px 46px 12px 12px; min-height: 56px; }
.recorder-workspace__panel :deep(.el-card__body) { padding: 10px; }
.recorder-workspace__collapse { position: absolute; right: 9px; top: 13px; }
.recorder-workspace__rail { display: flex; flex-direction: column; align-items: center; gap: 12px; border: 1px solid #dce3e8; border-radius: 4px; background: #fff; color: #475569; padding: 14px 4px; cursor: pointer; }
.recorder-workspace__rail span { writing-mode: vertical-rl; font-size: 13px; }
.recorder-workspace__separator { cursor: col-resize; touch-action: none; user-select: none; }
.recorder-workspace__separator:hover, .recorder-workspace__separator:focus-visible { background: #b3d8ff; outline: none; }
.recorder-workspace__separator.is-disabled { pointer-events: none; }
.recorder-workspace__panel--drawer { position: absolute; inset: 0 auto 0 0; width: min(340px, 100%); z-index: 22; background: #fff; box-shadow: 3px 0 16px #0002; }
.recorder-workspace__backdrop { position: absolute; inset: 0; border: 0; background: #0003; z-index: 21; }
</style>
