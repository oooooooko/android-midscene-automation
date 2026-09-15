<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { AppiumNode } from '../types';
import { Search } from '@element-plus/icons-vue';

const props = defineProps<{
  tree: AppiumNode | null;
  selectedId: string;
}>();

defineEmits<{
  select: [node: AppiumNode];
}>();

const containerRef = ref<HTMLElement | null>(null);
const query = ref('');
// Keep the tree data identity stable while typing so filtering is not reset.
const treeData = computed(() => props.tree ? [props.tree] : []);
const treeRef = ref<{ setCurrentKey: (key: string) => void; filter: (value: string) => void } | null>(null);
const filterNode = (value: string, node: AppiumNode) => !value || [node.label, node.resourceId, node.text, node.contentDesc, node.className].some((text) => text?.toLowerCase().includes(value.toLowerCase()));
watch(query, (value) => treeRef.value?.filter(value));
watch(() => props.tree, async () => { await nextTick(); treeRef.value?.filter(query.value); });

watch(
  () => props.selectedId,
  async () => {
    query.value = '';
    treeRef.value?.setCurrentKey(props.selectedId);
    await nextTick();
    containerRef.value
      ?.querySelector('.el-tree-node.is-current')
      ?.scrollIntoView({ block: 'center', inline: 'nearest' });
  },
);
</script>

<template>
  <div class="appium-tree-container">
  <el-input v-model="query" size="small" :prefix-icon="Search" clearable placeholder="搜索文字、ID、组件类型" aria-label="搜索组件" />
  <div ref="containerRef" class="appium-tree">
    <el-empty v-if="!tree" description="暂无组件树" />
    <el-tree
      v-else
      ref="treeRef"
      :data="treeData"
      node-key="id"
      :props="{ label: 'label', children: 'children' }"
      :current-node-key="selectedId"
      highlight-current
      default-expand-all
      :filter-node-method="filterNode"
      @node-click="$emit('select', $event)"
    >
      <template #default="{ data }">
        <span class="appium-tree-node">
          <span class="appium-tree-node__label" :title="`${data.label}\n${data.resourceId || data.className}`">{{ data.label }}</span>
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
  </div>
</template>

<style scoped>
.appium-tree-container { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.appium-tree { flex: 1; height: auto; overflow-x: hidden; }
.appium-tree :deep(.el-tree) { min-width: 0; }
.appium-tree-node { flex: 1; min-width: 0; overflow: hidden; }
.appium-tree-node__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
