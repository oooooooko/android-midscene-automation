<script setup lang="ts">
import { CopyDocument, Delete, View } from '@element-plus/icons-vue';
import DevicePreviewPanel from '../components/device/DevicePreviewPanel.vue';
import type { AndroidDevice, DeviceAction, ExecutionStep, SavedScript } from '../types';

defineProps<{
  savedScripts: SavedScript[];
  selectedScript?: SavedScript;
  playgroundAvailable: boolean;
  playgroundDeviceId: string;
  playgroundFrameUrl: string;
  playgroundPreviewError: string;
  devicePreviewUrl: string;
  androidDevices: AndroidDevice[];
  deviceActions: readonly DeviceAction[];
  executionLog: string;
  executionProcess: ExecutionStep[];
  lastRunStatus: string;
  runningElapsedText: string;
  formatScriptTime: (value: string) => string;
  switchAndroidDevice: (deviceId: string) => void;
  triggerDeviceKey: (keyCode: number) => void;
  refreshDevicePreview: () => void;
  openCodeDialog: (script: SavedScript) => void;
  removeSavedScript: (id: string) => void;
  deviceWidth: number;
  deviceHeight: number;
  tapDevice: (x: number, y: number) => void;
  swipeDevice: (startX: number, startY: number, endX: number, endY: number, duration?: number) => void;
}>();

const selectedScriptId = defineModel<string>('selectedScriptId', { required: true });

defineEmits<{
  clearExecutionLog: [];
  copyExecutionLog: [];
}>();

// 执行状态与 Element Plus tag 类型的映射只影响展示，不参与执行流程判断。
const getRunStatusTagType = (status: string) => {
  if (status === '执行完成') return 'success';
  if (status === '执行中' || status === '停止中' || status === '已停止') return 'warning';
  return 'danger';
};

// 将内部执行状态收敛成短标签文案，避免模板中重复三元判断。
const getRunStatusTagText = (status: string) => {
  if (status === '执行完成') return '完成';
  if (status === '执行中') return '执行中';
  if (status === '停止中') return '停止中';
  if (status === '已停止') return '已停止';
  return '失败';
};
</script>

<template>
  <section class="automation-layout">
    <el-card shadow="never" class="automation-card">
      <template #header>脚本列表</template>
      <div class="script-list">
        <div
          v-for="item in savedScripts"
          :key="item.id"
          role="button"
          tabindex="0"
          class="script-row"
          :class="{ 'script-row--active': selectedScriptId === item.id }"
          @click="selectedScriptId = item.id"
          @keydown.enter="selectedScriptId = item.id"
        >
          <div class="script-row__main">
            <strong>{{ item.promptTitle || item.name }}</strong>
            <span>{{ item.name }}</span>
            <small>{{ formatScriptTime(item.updatedAt) }}</small>
          </div>
          <div class="script-row__actions">
            <el-button
              text
              size="small"
              :icon="View"
              title="查看代码"
              aria-label="查看代码"
              @click.stop="openCodeDialog(item)"
            />
            <el-button text size="small" :icon="Delete" @click.stop="removeSavedScript(item.id)" />
          </div>
        </div>
        <el-empty v-if="!savedScripts.length" description="暂无脚本" />
      </div>
    </el-card>

    <div class="automation-stage">
      <DevicePreviewPanel
        :available="playgroundAvailable"
        :devices="androidDevices"
        :selected-device-id="playgroundDeviceId"
        :frame-url="playgroundFrameUrl"
        :image-url="devicePreviewUrl"
        :preview-error="playgroundPreviewError"
        :actions="deviceActions"
        :device-width="deviceWidth"
        :device-height="deviceHeight"
        @switch-device="switchAndroidDevice"
        @trigger-key="triggerDeviceKey"
        @refresh-preview="refreshDevicePreview"
        @tap="tapDevice($event.x, $event.y)"
        @swipe="swipeDevice($event.startX, $event.startY, $event.endX, $event.endY, $event.duration)"
      />

      <el-card shadow="never" class="automation-card execution-card">
        <template #header>执行面板</template>
        <el-form label-position="top">
          <el-form-item label="当前脚本">
            <el-input :model-value="selectedScript ? `${selectedScript.promptTitle || selectedScript.name} · ${selectedScript.name}` : ''" readonly />
          </el-form-item>
          <el-form-item class="execution-output-item">
            <div class="execution-output-section">
              <div class="execution-output-header">
                <strong>执行输出</strong>
                <div class="execution-output-toolbar">
                  <el-tag
                    v-if="lastRunStatus"
                    size="small"
                    :type="getRunStatusTagType(lastRunStatus)"
                  >
                    {{ getRunStatusTagText(lastRunStatus) }}
                  </el-tag>
                  <span v-if="runningElapsedText" class="execution-output-duration">
                    {{ runningElapsedText }}
                  </span>
                  <el-button
                    size="small"
                    text
                    :icon="CopyDocument"
                    :disabled="!executionLog"
                    @click="$emit('copyExecutionLog')"
                  >
                    复制
                  </el-button>
                  <el-button size="small" text :disabled="!executionLog" @click="$emit('clearExecutionLog')">
                    清除
                  </el-button>
                </div>
              </div>
              <div class="execution-log execution-log--panel">
                <textarea
                  v-if="executionLog"
                  class="execution-log__output"
                  :value="executionLog"
                  readonly
                  wrap="off"
                  spellcheck="false"
                />
              </div>
            </div>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </section>
</template>
