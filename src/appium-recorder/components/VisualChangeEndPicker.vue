<script setup lang="ts">
defineProps<{ candidates: { id: string; label: string; number: number }[] }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <div class="visual-end-picker" aria-label="可结束的画面变化检测">
    <button v-for="item in candidates" :key="item.id" type="button" @click="emit('select', item.id)">
      <strong>{{ item.label }}</strong>
      <span>开始节点 #{{ item.number }}</span>
    </button>
  </div>
</template>

<style scoped>
.visual-end-picker { display: grid; gap: 4px; max-height: 320px; overflow: auto; }
.visual-end-picker button { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; width: 100%; padding: 10px 12px; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-primary); font: inherit; text-align: left; cursor: pointer; }
.visual-end-picker button:hover, .visual-end-picker button:focus-visible { background: var(--el-fill-color-light); outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.visual-end-picker strong { font-size: 14px; overflow-wrap: anywhere; }
.visual-end-picker span { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
