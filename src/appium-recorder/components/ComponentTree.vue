<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { AppiumNode } from '../types';

const props = defineProps<{
  tree: AppiumNode | null;
  selectedId: string;
}>();

defineEmits<{
  select: [node: AppiumNode];
}>();

const containerRef = ref<HTMLElement | null>(null);
const treeRef = ref<{ setCurrentKey: (key: string) => void } | null>(null);

watch(
  () => props.selectedId,
  async () => {
    treeRef.value?.setCurrentKey(props.selectedId);
    await nextTick();
    containerRef.value
      ?.querySelector('.el-tree-node.is-current')
      ?.scrollIntoView({ block: 'center', inline: 'nearest' });
  },
);
</script>

<template>
  <div ref="containerRef" class="appium-tree">
    <el-empty v-if="!tree" description="暂无组件树" />
    <el-tree
      v-else
      ref="treeRef"
      :data="[tree]"
      node-key="id"
      :props="{ label: 'label', children: 'children' }"
      :current-node-key="selectedId"
      highlight-current
      default-expand-all
      @node-click="$emit('select', $event)"
    >
      <template #default="{ data }">
        <span class="appium-tree-node">
          <span class="appium-tree-node__label">{{ data.label }}</span>
          <span
            v-if="data.selector?.matchCount"
            class="appium-tree-node__badge"
            :class="{ 'appium-tree-node__badge--duplicate': data.selector.matchCount > 1 }"
          >
            {{ data.selector.matchCount > 1 ? `重复 ${data.selector.matchCount}` : '唯一' }}
          </span>
        </span>
      </template>
    </el-tree>
  </div>
</template>
