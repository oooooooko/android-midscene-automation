<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ArrowDown, ArrowUp, Search } from '@element-plus/icons-vue';
import type { FlowSearchResult } from '../flow-search';

const props = defineProps<{ query: string; results: FlowSearchResult[]; selectedId: string }>();
const emit = defineEmits<{ 'update:query': [value: string]; select: [id: string] }>();
const input = ref<{ focus: () => void }>();
const list = ref<HTMLElement>();
const currentIndex = computed(() => props.results.findIndex((result) => result.id === props.selectedId));
async function choose(id: string) {
  emit('select', id);
  await nextTick();
  list.value?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}
function move(direction: number) {
  if (!props.results.length) return;
  const index = (currentIndex.value + direction + props.results.length) % props.results.length;
  void choose(props.results[index]!.id);
}
</script>

<template>
  <el-popover trigger="click" placement="bottom-start" :width="360" popper-class="flow-node-search-popover" @after-enter="input?.focus()">
    <template #reference><span class="flow-node-search-trigger"><el-tooltip content="搜索节点" placement="top" :show-after="200"><el-button :icon="Search" aria-label="搜索节点" size="small" /></el-tooltip></span></template>
    <div class="flow-node-search">
      <el-input ref="input" :model-value="query" placeholder="搜索名称、操作、定位内容或日志" aria-label="搜索流程节点" clearable @update:model-value="emit('update:query', $event)" @keydown.enter.prevent="move($event.shiftKey ? -1 : 1)" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" />
      <div class="flow-node-search__navigation">
        <span aria-live="polite">{{ currentIndex + 1 }} / {{ results.length }}</span>
        <el-tooltip content="上一个结果" placement="top"><span><el-button :icon="ArrowUp" size="small" aria-label="上一个结果" :disabled="!results.length" @click="move(-1)" /></span></el-tooltip>
        <el-tooltip content="下一个结果" placement="top"><span><el-button :icon="ArrowDown" size="small" aria-label="下一个结果" :disabled="!results.length" @click="move(1)" /></span></el-tooltip>
      </div>
      <div ref="list" class="flow-node-search__results">
        <button v-for="result in results" :key="result.id" type="button" class="flow-node-search__result" :aria-current="result.id === selectedId" @click="choose(result.id)">
          <strong>{{ result.index + 1 }}. {{ result.title }}</strong>
          <span>{{ result.meta }}</span>
          <small>{{ result.branch }}</small>
        </button>
        <div v-if="query.trim() && !results.length" class="flow-node-search__empty">未找到匹配节点</div>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.flow-node-search-trigger { display: inline-flex; }
.flow-node-search-trigger .el-button { width: 30px; height: 30px; min-height: 30px; padding: 0; }
.flow-node-search__navigation { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin: 8px 0; }
.flow-node-search__navigation > span:first-child { margin-right: auto; font-size: 12px; }
.flow-node-search__navigation .el-button { width: 26px; height: 26px; min-height: 26px; padding: 0; }
.flow-node-search__results { max-height: min(320px, 45vh); overflow: auto; }
.flow-node-search__result { display: flex; flex-direction: column; text-align: left; gap: 4px; width: 100%; border: 0; border-bottom: 1px solid #e4e7ed; padding: 10px 8px; background: #fff; color: #303133; cursor: pointer; overflow-wrap: anywhere; }
.flow-node-search__result[aria-current="true"] { background: #e6f4ff; }
.flow-node-search__result:hover { background: #f0f7fc; }
.flow-node-search__result strong { font-size: 13px; }
.flow-node-search__result span, .flow-node-search__result small { font-size: 12px; color: #606266; }
.flow-node-search__empty { padding: 16px 0; text-align: center; color: #606266; }
</style>

<style>
.flow-node-search-popover.el-popover { max-width: calc(100vw - 24px); box-sizing: border-box; }
</style>
