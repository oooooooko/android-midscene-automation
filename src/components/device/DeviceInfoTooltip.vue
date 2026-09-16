<script setup lang="ts">
import { shallowRef, watch, onBeforeUnmount } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';
import { APP_BASE } from '../../api';
import type { AndroidDeviceDetails } from '../../types';

const props = defineProps<{ deviceId: string }>();
const details = shallowRef<AndroidDeviceDetails>();
const loading = shallowRef(false);
const error = shallowRef('');
let request: AbortController | undefined;
const fields: [keyof AndroidDeviceDetails, string][] = [
  ['name', '设备名称'], ['brand', '品牌'], ['model', '型号'], ['processor', '处理器'],
  ['androidVersion', 'Android 版本'], ['physicalResolution', '物理分辨率'], ['resolution', '分辨率'],
];
watch(() => props.deviceId, () => { request?.abort(); request = undefined; details.value = undefined; error.value = ''; loading.value = false; });
onBeforeUnmount(() => request?.abort());
async function load() {
  if (!props.deviceId || loading.value) return;
  const controller = new AbortController();
  request = controller; loading.value = true; error.value = '';
  try {
    const response = await fetch(`${APP_BASE}/api/android-device-info?deviceId=${encodeURIComponent(props.deviceId)}`, { signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '读取设备信息失败');
    if (request === controller) details.value = payload.details;
  } catch (cause) {
    if (request === controller && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '读取失败';
  } finally { if (request === controller) loading.value = false; }
}
</script>

<template>
  <el-tooltip placement="bottom" effect="dark" :show-after="200" @before-show="load">
    <template #content>
      <div class="device-info">
        <div v-if="!deviceId">未选择设备</div>
        <template v-else>
          <div v-if="loading">正在读取设备信息…</div>
          <div v-if="error" role="status">{{ error }}</div>
          <dl><template v-for="[key, label] in fields" :key="key"><dt>{{ label }}</dt><dd>{{ details?.[key] || '未知' }}</dd></template></dl>
        </template>
      </div>
    </template>
    <el-button class="device-info-help" :icon="QuestionFilled" text aria-label="设备信息" />
  </el-tooltip>
</template>

<style scoped>
.device-info-help { width: 28px; height: 28px; padding: 0; font-size: 16px; }
.device-info { max-width: min(340px, calc(100vw - 40px)); font-size: 12px; overflow-wrap: anywhere; }
.device-info dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 14px; margin: 4px 0; }
.device-info dt { color: #cbd5e1; }
.device-info dd { margin: 0; }
</style>
