<script setup lang="ts">
import { onScopeDispose, shallowRef, watch } from 'vue';
import { APP_BASE } from '../api';

const props = defineProps<{ active: boolean }>();
const loading = shallowRef(false);
const message = shallowRef('');
const url = shallowRef('');
const frameUrl = shallowRef('');
const revision = shallowRef(0);
let controller: AbortController | undefined;

async function connect(reload = false) {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  message.value = '';
  try {
    const response = await fetch(`${APP_BASE}/api/artemis/status`, { signal: request.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '连接检查失败');
    url.value = data.url;
    if (!data.available) throw new Error(data.message);
    if (!data.ancestors.includes(window.location.origin)) {
      throw new Error('Artemis 未允许当前页面嵌入。请停止原服务，再用 npm run artemis 启动；自定义端口需配置 ARTEMIS_EMBED_ORIGINS。');
    }
    frameUrl.value = data.url;
    if (reload) revision.value++;
  } catch (error) {
    if (request.signal.aborted) return;
    frameUrl.value = '';
    message.value = error instanceof Error ? error.message : '连接检查失败';
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}

watch(() => props.active, active => { if (active) void connect(); }, { immediate: true });
onScopeDispose(() => controller?.abort());
</script>

<template>
  <section class="artemis-page" aria-label="Artemis 控制台">
    <div class="artemis-toolbar">
      <span>Artemis · Android AI 自动化</span>
      <div class="artemis-actions">
        <el-button :loading="loading" @click="connect(true)">重新连接</el-button>
        <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer">独立打开</a>
      </div>
    </div>
    <div v-if="message" class="artemis-empty" role="status">
      <h2>Artemis 暂不可用</h2>
      <p>{{ message }}</p>
      <p>启动服务后，点击“重新连接”。模型和设备在 Artemis 内配置。</p>
      <code>npm run artemis</code>
    </div>
    <div v-else-if="!frameUrl" class="artemis-empty" role="status">正在连接 Artemis…</div>
    <iframe v-if="frameUrl" :key="revision" :src="frameUrl" title="Artemis Android 自动化控制台" allow="clipboard-write" class="artemis-frame" />
  </section>
</template>

<style scoped>
.artemis-page { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--ui-bg); }
.artemis-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--ui-border); font-size: 14px; }
.artemis-actions { display: flex; align-items: center; gap: 16px; }
.artemis-actions a { color: var(--ui-primary); text-decoration: none; }
.artemis-frame { flex: 1; width: 100%; min-height: 0; border: 0; }
.artemis-empty { padding: 40px 24px; text-align: center; color: var(--ui-text-secondary); }
.artemis-empty h2 { color: var(--ui-text); font-size: 18px; }
.artemis-empty code { display: inline-block; padding: 10px 20px; background: var(--ui-bg); border-radius: var(--ui-radius-control); }
</style>
