<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { AppiumNode } from '../types';
import { ArrowDown, ArrowUp, Search } from '@element-plus/icons-vue';
import { flattenNodes } from '../tree';

const props = defineProps<{
  tree: AppiumNode | null;
  selectedId: string;
}>();

const emit = defineEmits<{
  select: [node: AppiumNode];
}>();

const containerRef = ref<HTMLElement | null>(null);
const query = ref('');
const currentMatchIndex = ref(-1);
// Keep the tree data identity stable while typing so filtering is not reset.
const treeData = computed(() => props.tree ? [props.tree] : []);
const treeRef = ref<{ setCurrentKey: (key: string) => void; filter: (value: string) => void } | null>(null);
const filterNode = (value: string, node: AppiumNode) => !value || [node.label, node.resourceId, node.text, node.contentDesc, node.className].some((text) => text?.toLowerCase().includes(value.toLowerCase()));
const matches = computed(() => {
  const value = query.value.trim();
  return value ? flattenNodes(props.tree).filter(node => filterNode(value, node)) : [];
});
const matchPosition = computed(() => matches.value.length && currentMatchIndex.value >= 0
  ? `${currentMatchIndex.value + 1}/${matches.value.length}`
  : `0/${matches.value.length}`);

const scrollToCurrentNode = async () => {
  await nextTick();
  containerRef.value
    ?.querySelector('.el-tree-node.is-current')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' });
};

const focusMatch = (index: number) => {
  if (!matches.value.length) return;
  currentMatchIndex.value = (index + matches.value.length) % matches.value.length;
  const node = matches.value[currentMatchIndex.value];
  treeRef.value?.setCurrentKey(node.id);
  emit('select', node);
  void scrollToCurrentNode();
};

const refreshSearch = async () => {
  treeRef.value?.filter(query.value);
  await nextTick();
  if (!query.value.trim() || !matches.value.length) {
    currentMatchIndex.value = -1;
    return;
  }
  const selectedMatchIndex = matches.value.findIndex(node => node.id === props.selectedId);
  focusMatch(selectedMatchIndex >= 0 ? selectedMatchIndex : 0);
};

watch(query, refreshSearch);
watch(() => props.tree, refreshSearch);

watch(
  () => props.selectedId,
  async () => {
    if (query.value.trim()) {
      const selectedMatchIndex = matches.value.findIndex(node => node.id === props.selectedId);
      if (selectedMatchIndex >= 0) currentMatchIndex.value = selectedMatchIndex;
      else query.value = '';
    }
    treeRef.value?.setCurrentKey(props.selectedId);
    await scrollToCurrentNode();
  },
);
</script>

<template>
  <div class="appium-tree-container">
  <div class="appium-tree-search">
    <el-input
      v-model="query"
      size="small"
      :prefix-icon="Search"
      clearable
      placeholder="搜索文字、ID、组件类型"
      aria-label="搜索组件"
      @keydown.enter.prevent="focusMatch(currentMatchIndex + ($event.shiftKey ? -1 : 1))"
      @keydown.up.prevent="focusMatch(currentMatchIndex - 1)"
      @keydown.down.prevent="focusMatch(currentMatchIndex + 1)"
    />
    <span class="appium-tree-search__count" aria-live="polite">{{ matchPosition }}</span>
    <el-tooltip content="上一个匹配项（Shift + Enter）" placement="top" :show-after="200">
      <el-button :icon="ArrowUp" size="small" aria-label="上一个匹配项" :disabled="!matches.length" @click="focusMatch(currentMatchIndex - 1)" />
    </el-tooltip>
    <el-tooltip content="下一个匹配项（Enter）" placement="top" :show-after="200">
      <el-button :icon="ArrowDown" size="small" aria-label="下一个匹配项" :disabled="!matches.length" @click="focusMatch(currentMatchIndex + 1)" />
    </el-tooltip>
  </div>
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
.appium-tree-container { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.appium-tree-search { display: flex; align-items: center; gap: 2px; }
.appium-tree-search .el-input { flex: 1; min-width: 0; }
.appium-tree-search__count { min-width: 28px; padding: 0 2px; text-align: center; font-size: 11px; color: var(--ui-text-secondary); font-variant-numeric: tabular-nums; }
.appium-tree-search .el-button { flex: none; width: 24px; height: 24px; min-height: 24px; padding: 0; border-radius: 5px; }
.appium-tree-search .el-button + .el-button { margin-left: 0; }
.appium-tree { flex: 1; height: auto; overflow: auto; }
.appium-tree :deep(.el-tree) { width: max-content; min-width: 100%; }
.appium-tree-node { flex: 1 0 auto; }
.appium-tree-node__label { white-space: nowrap; }
</style>
