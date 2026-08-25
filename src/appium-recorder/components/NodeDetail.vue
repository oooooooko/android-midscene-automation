<script setup lang="ts">
import type { AppiumNode } from '../types';

defineProps<{
  node: AppiumNode | null;
  currentActivity?: string;
  loading?: boolean;
}>();
</script>

<template>
  <div
    v-loading="loading"
    element-loading-text="正在检测页面变化..."
    class="appium-node-detail"
  >
    <template v-if="node">
      <div class="appium-node-detail__title">{{ node.label }}</div>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="resource-id">{{ node.resourceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="content-desc">{{ node.contentDesc || '-' }}</el-descriptions-item>
        <el-descriptions-item label="text">{{ node.text || '-' }}</el-descriptions-item>
        <el-descriptions-item label="class">{{ node.className || '-' }}</el-descriptions-item>
        <el-descriptions-item label="当前 Activity">{{ currentActivity || '-' }}</el-descriptions-item>
        <el-descriptions-item label="selector">
          <span v-if="currentActivity">Activity {{ currentActivity }} · </span>
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
            <template v-if="currentActivity">Activity {{ currentActivity }} + </template>
            父级 {{ node.contextSelector.strategy }} {{ node.contextSelector.value || '' }}
            + 子级 {{ node.selector.strategy }} {{ node.selector.value || '' }}
          </span>
          <span v-else>
            <template v-if="currentActivity">Activity {{ currentActivity }} + </template>
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
    <el-empty v-else description="请选择组件" />

  </div>
</template>
