<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import type { AppiumNode } from '../types';
import ComponentTree from './ComponentTree.vue';
import NodeDetail from './NodeDetail.vue';
defineProps<{ tree: AppiumNode | null; node: AppiumNode | null; activity: string; loading: boolean; disabled: boolean; recording: boolean }>();
defineEmits<{ refresh: []; select: [node: AppiumNode] }>();
</script>

<template>
  <el-card shadow="never" class="appium-recorder-card component-inspector">
    <template #header><div class="panel-header"><span>App 组件树</span><el-tooltip content="刷新组件树" placement="top" :show-after="200"><el-button class="recorder-panel-tool" :icon="Refresh" size="small" aria-label="刷新组件树" :loading="loading" :disabled="disabled" @click="$emit('refresh')" /></el-tooltip></div></template>
    <ComponentTree :tree="tree" :selected-id="node?.id || ''" @select="$emit('select', $event)" />
    <NodeDetail :node="node" :current-activity="activity" :loading="recording" />
    <div class="component-inspector__activity">
      <span>Activity</span>
      <el-tooltip :content="activity" :disabled="!activity" placement="top" effect="dark" :show-after="200"
        :popper-style="{ maxWidth: 'min(480px, calc(100vw - 24px))', overflowWrap: 'anywhere', fontSize: '12px' }">
        <code :tabindex="activity ? 0 : undefined">{{ activity || '-' }}</code>
      </el-tooltip>
    </div>
  </el-card>
</template>

<style scoped>
.component-inspector :deep(> .el-card__body) { display: flex; flex-direction: column; overflow: hidden; gap: 8px; }
.component-inspector :deep(.appium-tree-container) { flex: 1; min-height: 0; }
.component-inspector :deep(.appium-node-summary) { flex: none; }
.panel-header { font-size: 14px; gap: 4px; }
.component-inspector__activity { flex: none; display: flex; min-width: 0; gap: 6px; padding-top: 8px; border-top: 1px solid #e4e7ed; font-size: 12px; color: #606266; }
.component-inspector__activity > span { flex-shrink: 0; }
.component-inspector__activity code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
