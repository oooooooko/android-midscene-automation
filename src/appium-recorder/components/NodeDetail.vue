<script setup lang="ts">
import { ref } from 'vue';
import { View } from '@element-plus/icons-vue';
import type { AppiumNode } from '../types';

defineProps<{
  node: AppiumNode | null;
  currentActivity?: string;
  loading?: boolean;
}>();
const detailsVisible = ref(false);
</script>

<template>
  <div
    v-loading="loading"
    element-loading-text="正在检测页面变化..."
    class="appium-node-detail"
  >
    <div class="appium-node-summary">
      <div class="appium-node-summary__text" v-if="node">
        <strong :title="node.label">{{ node.label }}</strong>
        <span>{{ node.className.split('.').pop() }}<template v-if="node.checkable"> · {{ node.checked === undefined ? '勾选状态未知' : node.checked ? '已勾选' : '未勾选' }}</template><template v-if="node.selector.matchCount"> · {{ node.selector.matchCount > 1 ? `定位重复 ${node.selector.matchCount}` : '定位唯一' }}</template></span>
      </div>
      <span v-else class="appium-node-summary__empty">请选择组件</span>
      <el-button size="small" type="primary" :icon="View" :disabled="!node" @click="detailsVisible = true">详情</el-button>
    </div>
    <el-drawer v-model="detailsVisible" title="组件详情" size="520px" style="max-width: 94vw" append-to-body>
    <template v-if="node">
      <div class="appium-node-detail__title">{{ node.label }}</div>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="resource-id">{{ node.resourceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="content-desc">{{ node.contentDesc || '-' }}</el-descriptions-item>
        <el-descriptions-item label="text">{{ node.text || '-' }}</el-descriptions-item>
        <el-descriptions-item label="class">{{ node.className || '-' }}</el-descriptions-item>
        <el-descriptions-item v-if="node.checkable !== undefined" label="checkable">{{ String(node.checkable) }}</el-descriptions-item>
        <el-descriptions-item v-if="node.checkable" label="checked">{{ node.checked === undefined ? '-' : String(node.checked) }}</el-descriptions-item>
        <el-descriptions-item label="当前 Activity">{{ currentActivity || '-' }}</el-descriptions-item>
        <el-descriptions-item label="selector">
          {{ node.selector.strategy }} {{ node.selector.value || '' }}
          <el-tag
            v-if="node.selector.matchCount"
            size="small"
            :type="node.selector.matchCount > 1 ? 'warning' : 'success'"
          >
            {{ node.selector.matchCount > 1 ? `重复 ${node.selector.matchCount}` : '唯一' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="推荐定位">
          <span v-if="node.contextSelector">
            父级 {{ node.contextSelector.strategy }} {{ node.contextSelector.value || '' }}
            + 子级 {{ node.selector.strategy }} {{ node.selector.value || '' }}
          </span>
          <span v-else>
            {{ node.selector.unique ? '当前 selector 唯一' : '使用当前 selector 或坐标兜底' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="bounds">
          <span v-if="node.bounds">
            [{{ node.bounds.left }},{{ node.bounds.top }}][{{ node.bounds.right }},{{ node.bounds.bottom }}]
          </span>
          <span v-else>-</span>
        </el-descriptions-item>
      </el-descriptions>
    </template>
    <p v-else>请选择组件</p>
    </el-drawer>

  </div>
</template>

<style scoped>
.appium-node-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 6px 0; }
.appium-node-summary__text { display: grid; gap: 2px; min-width: 0; font-size: 12px; }
.appium-node-summary__text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.appium-node-summary__text span, .appium-node-summary__empty { color: var(--el-text-color-secondary); font-size: 12px; }
:deep(.el-descriptions__content) { overflow-wrap: anywhere; word-break: break-word; }
</style>
