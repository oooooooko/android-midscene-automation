<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { testAiRecognition } from '../api';
import { AI_MODEL_CONFIG_HINT, validateAiRecognitionPrompt } from '../ai-recognition';
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
    result.value = await testAiRecognition({ deviceId: props.deviceId, prompt, timeoutMs: props.step.timeoutMs }, controller.signal);
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
      <p v-if="loading">识别中…</p>
      <template v-if="result">
        <div class="ai-recognition-test__result">
          <strong>{{ String(result.result) }}</strong>
          <span>{{ result.durationMs }}ms</span>
        </div>
        <p>{{ result.reason }}</p>
        <el-image
          v-if="result.imageBase64"
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
.ai-recognition-test { overflow-wrap: anywhere; }
.ai-recognition-test__prompt { white-space: pre-wrap; margin-top: 0; }
.ai-recognition-test__result { display: flex; align-items: center; gap: 16px; }
.ai-recognition-test__result strong { font-size: 20px; }
.ai-recognition-test__image { display: block; width: 100%; height: 280px; }
</style>
