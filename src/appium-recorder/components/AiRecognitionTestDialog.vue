<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { testAiRecognition } from '../api';
import { AI_MODEL_CONFIG_HINT, validateAiRecognitionPrompt, isAiBranchEnabled } from '../ai-recognition';
import type { AppiumRecordedStep } from '../types';

const props = defineProps<{ step: AppiumRecordedStep; deviceId: string; modelConfigured: boolean }>();
defineEmits<{ close: [] }>();
const loading = shallowRef(false);
const error = shallowRef('');
const result = shallowRef<Awaited<ReturnType<typeof testAiRecognition>> | null>(null);
let controller: AbortController | undefined;

async function runTest() {
  if (loading.value) return;
  error.value = '';
  result.value = null;
  controller = new AbortController();
  loading.value = true;
  try {
    if (!props.modelConfigured) throw new Error(AI_MODEL_CONFIG_HINT);
    if (!props.deviceId) throw new Error('请选择设备');
    const prompt = validateAiRecognitionPrompt(props.step.value);
    result.value = await testAiRecognition({ deviceId: props.deviceId, prompt, timeoutMs: props.step.timeoutMs, aiTimeoutEnabled: props.step.aiTimeoutEnabled === true, aiBranchEnabled: isAiBranchEnabled(props.step), aiObservation: props.step.aiObservation }, controller.signal);
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : 'AI 识别测试失败';
  } finally {
    loading.value = false;
  }
}

onMounted(runTest);
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <el-dialog :model-value="true" title="测试 AI 识别" width="min(560px, calc(100vw - 32px))" append-to-body @close="$emit('close')">
    <div class="ai-recognition-test" aria-live="polite">
      <p class="ai-recognition-test__prompt">{{ step.value }}</p>
      <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />
      <p v-if="loading">{{ step.aiObservation?.mode === 'untilMatch' ? `边观察边检测中…（最长采样 ${step.aiObservation.durationMs / 1000} 秒，命中即结束，未命中需等待剩余识别）` : step.aiObservation ? `持续观察并分析中…（观察 ${step.aiObservation.durationMs / 1000} 秒，之后等待模型返回）` : '识别中…' }}</p>
      <template v-if="result">
        <div class="ai-recognition-test__result">
          <strong>{{ result.result === null ? '识别完成' : String(result.result) }}</strong>
          <span>{{ result.durationMs }}ms</span>
        </div>
        <p>{{ result.reason }}</p>
        <template v-if="result.observation">
          <p v-if="result.observation.completion">{{ result.observation.completion === 'matched' ? '检测命中，已结束观察' : '观察结束，未命中条件' }} · 模型请求 {{ result.observation.modelRequestCount }} 次</p>
          <p>实际观察 {{ (result.observation.durationMs / 1000).toFixed(1) }} 秒，采集 {{ result.observation.sampleCount ?? result.observation.frames.length }} 帧，提交模型 {{ result.observation.frames.length }} 帧</p>
          <p v-if="result.observation.deduplicationMethod">去重方式：{{ result.observation.deduplicationMethod === 'none' ? '不去重' : result.observation.deduplicationMethod === 'opencv' ? 'OpenCV（SSIM）' : 'pixelmatch' }}；下方为实际提交画面。</p>
          <div class="ai-observation-frames">
            <figure v-for="(frame, index) in result.observation.frames" :key="index">
              <el-image :src="frame.imageDataUrl" :preview-src-list="result.observation.frames.map(item => item.imageDataUrl)" :initial-index="index" preview-teleported fit="contain" :alt="`观察第 ${index + 1} 帧`" />
              <figcaption>第 {{ index + 1 }} 帧 · {{ (frame.elapsedMs / 1000).toFixed(1) }}s</figcaption>
            </figure>
          </div>
        </template>
        <el-image
          v-else-if="result.imageBase64"
          class="ai-recognition-test__image" fit="contain"
          :src="`data:image/png;base64,${result.imageBase64}`"
          :preview-src-list="[`data:image/png;base64,${result.imageBase64}`]"
          preview-teleported alt="AI 识别使用的设备截图"
        />
      </template>
    </div>
    <template #footer>
      <el-button @click="$emit('close')">关闭</el-button>
      <el-button type="primary" :icon="Refresh" :loading="loading" :disabled="!modelConfigured || !deviceId" @click="runTest">重新测试</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ai-observation-frames { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-height: 360px; overflow-y: auto; }
.ai-observation-frames figure { margin: 0; }
.ai-observation-frames .el-image { width: 100%; height: 140px; }
.ai-observation-frames figcaption { font-size: 12px; text-align: center; }
.ai-recognition-test { overflow-wrap: anywhere; }
.ai-recognition-test__prompt { white-space: pre-wrap; margin-top: 0; }
.ai-recognition-test__result { display: flex; align-items: center; gap: 16px; }
.ai-recognition-test__result strong { font-size: 20px; }
.ai-recognition-test__image { display: block; width: 100%; height: 280px; }
</style>
