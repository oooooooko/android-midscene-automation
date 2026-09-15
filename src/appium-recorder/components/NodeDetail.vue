<script setup lang="ts">
import { computed, ref } from 'vue';
import { View, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { AppiumNode } from '../types';
import { nodeLocators } from '../node-locators';

const props = defineProps<{
  node: AppiumNode | null;
  currentActivity?: string;
  loading?: boolean;
}>();
const detailsVisible = ref(false);
const locators = computed(() => props.node ? nodeLocators(props.node) : []);
async function copyLocator(value: string) {
  if (!value) return;
  try { await navigator.clipboard.writeText(value); ElMessage.success('定位内容已复制'); }
  catch { ElMessage.error('复制失败，请手动选择定位内容复制'); }
}
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
      <el-descriptions class="appium-node-properties" :column="1" border size="small">
        <el-descriptions-item v-for="locator in locators" :key="locator.name">
          <template #label><span class="appium-node-locator-label">{{ locator.name }}<small v-if="locator.attribute">{{ locator.attribute }}</small></span></template>
          <div class="appium-node-locator">
            <code>{{ locator.value || '未提供' }}</code>
            <el-tooltip :content="`复制 ${locator.name}`" placement="top" :show-after="200">
              <el-button class="appium-node-locator-copy" size="small" :icon="CopyDocument" :disabled="!locator.value" :aria-label="`复制 ${locator.name}`" @click="copyLocator(locator.value)" />
            </el-tooltip>
          </div>
          <small v-if="locator.warning" class="appium-node-locator-warning">{{ locator.warning }}</small>
        </el-descriptions-item>
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
.appium-node-properties :deep(.el-descriptions__table) { table-layout: fixed; width: 100%; }
.appium-node-properties :deep(.el-descriptions__label) { width: 118px; overflow-wrap: anywhere; }
.appium-node-locator-label { display: grid; gap: 2px; }
.appium-node-locator-label small { font-weight: 400; color: var(--el-text-color-secondary); }
.appium-node-locator { display: flex; align-items: flex-start; gap: 8px; }
.appium-node-locator code { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.appium-node-locator .appium-node-locator-copy { flex: none; width: 26px; height: 26px; min-height: 26px; padding: 0; }
.appium-node-locator-warning { display: block; margin-top: 4px; color: var(--el-color-warning); }
</style>
