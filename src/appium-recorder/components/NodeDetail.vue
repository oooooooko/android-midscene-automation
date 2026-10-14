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
const locatorItems = computed(() => {
  const node = props.node;
  if (!node) return [];
  const available = nodeLocators(node).filter(locator => Boolean(locator.value));
  const preferredNames: Partial<Record<AppiumNode['selector']['strategy'], string>> = {
    id: 'Resource ID',
    accessibilityId: 'Accessibility ID',
    xpath: 'XPath',
    androidUiAutomator: 'UiAutomator',
  };
  const preferredName = preferredNames[node.selector.strategy];
  const preferredIndex = Math.max(0, available.findIndex(locator => locator.name === preferredName));
  const descriptions: Record<string, string> = {
    'Resource ID': '通常最稳定，页面文案变化时也可继续定位',
    'Accessibility ID': '使用 content-desc 定位，适合无 Resource ID 的组件',
    XPath: '依赖组件层级，页面结构变化后可能需要重新获取',
    UiAutomator: 'Android 原生定位表达式，可组合组件属性',
  };
  return available
    .map((locator, index) => ({
      ...locator,
      description: descriptions[locator.name] || '',
      recommended: index === preferredIndex,
    }))
    .sort((left, right) => Number(right.recommended) - Number(left.recommended));
});
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
    <el-drawer v-model="detailsVisible" title="组件详情" size="560px" class="appium-node-detail-drawer" append-to-body destroy-on-close>
      <template v-if="node">
        <div class="appium-node-detail__content">
          <section class="appium-node-detail__summary">
            <div>
              <span>当前组件</span>
              <strong>{{ node.label }}</strong>
              <code>{{ node.className || '未知组件类型' }}</code>
            </div>
            <div class="appium-node-detail__tags">
              <el-tag :type="node.enabled ? 'success' : 'info'" size="small">{{ node.enabled ? '可用' : '不可用' }}</el-tag>
              <el-tag :type="node.clickable ? 'primary' : 'info'" size="small">{{ node.clickable ? '可点击' : '不可点击' }}</el-tag>
              <el-tag v-if="node.selector.matchCount" :type="node.selector.matchCount > 1 ? 'warning' : 'success'" size="small">{{ node.selector.matchCount > 1 ? `定位重复 ${node.selector.matchCount}` : '定位唯一' }}</el-tag>
            </div>
          </section>

          <section class="appium-node-detail__panel appium-node-detail__panel--locators">
            <div class="appium-node-detail__heading">
              <strong>定位方式</strong>
              <span>已按当前脚本使用优先级排列，未提供的定位属性自动隐藏</span>
            </div>
            <div class="appium-node-locators">
              <article v-for="locator in locatorItems" :key="locator.name" class="appium-node-locator-card" :class="{ 'is-recommended': locator.recommended }">
                <div class="appium-node-locator-card__header">
                  <el-tooltip :content="locator.description" placement="top" :show-after="300">
                    <span class="appium-node-locator-label"><strong>{{ locator.name }}</strong><small v-if="locator.attribute">{{ locator.attribute }}</small></span>
                  </el-tooltip>
                  <el-tag v-if="locator.recommended" type="primary" size="small">当前使用</el-tag>
                </div>
                <div class="appium-node-locator-value">
                  <code>{{ locator.value }}</code>
                  <el-tooltip :content="`复制 ${locator.name}`" placement="top" :show-after="200">
                    <el-button class="appium-node-locator-copy" text size="small" :icon="CopyDocument" :aria-label="`复制 ${locator.name}`" @click="copyLocator(locator.value)" />
                  </el-tooltip>
                </div>
                <small v-if="locator.warning" class="appium-node-locator-warning">{{ locator.warning }}</small>
              </article>
              <el-empty v-if="!locatorItems.length" :image-size="48" description="当前组件没有可用定位信息" />
            </div>
          </section>

          <section class="appium-node-detail__panel">
            <div class="appium-node-detail__heading"><strong>组件属性</strong><span>当前组件树快照中的原始信息</span></div>
            <el-descriptions class="appium-node-properties" :column="1" border size="small">
              <el-descriptions-item label="text">{{ node.text || '-' }}</el-descriptions-item>
              <el-descriptions-item label="content-desc">{{ node.contentDesc || '-' }}</el-descriptions-item>
              <el-descriptions-item label="resource-id">{{ node.resourceId || '-' }}</el-descriptions-item>
              <el-descriptions-item label="class">{{ node.className || '-' }}</el-descriptions-item>
              <el-descriptions-item label="package">{{ node.packageName || '-' }}</el-descriptions-item>
              <el-descriptions-item label="enabled">{{ String(node.enabled) }}</el-descriptions-item>
              <el-descriptions-item label="clickable">{{ String(node.clickable) }}</el-descriptions-item>
              <el-descriptions-item v-if="node.checkable !== undefined" label="checkable">{{ String(node.checkable) }}</el-descriptions-item>
              <el-descriptions-item v-if="node.checkable" label="checked">{{ node.checked === undefined ? '-' : String(node.checked) }}</el-descriptions-item>
              <el-descriptions-item label="当前 Activity">{{ currentActivity || '-' }}</el-descriptions-item>
              <el-descriptions-item label="selector">
                <code>{{ node.selector.strategy }} {{ node.selector.value || '' }}</code>
              </el-descriptions-item>
              <el-descriptions-item label="推荐定位">
                <span v-if="node.contextSelector">父级 {{ node.contextSelector.strategy }} {{ node.contextSelector.value || '' }} + 子级 {{ node.selector.strategy }} {{ node.selector.value || '' }}</span>
                <span v-else>{{ node.selector.unique ? '当前 selector 唯一' : '使用当前 selector，定位失败时使用坐标兜底' }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="bounds">
                <code v-if="node.bounds">[{{ node.bounds.left }},{{ node.bounds.top }}][{{ node.bounds.right }},{{ node.bounds.bottom }}]</code>
                <span v-else>-</span>
              </el-descriptions-item>
            </el-descriptions>
          </section>
        </div>
      </template>
      <el-empty v-else description="请选择组件" />
      <template #footer><el-button type="primary" @click="detailsVisible = false">关闭</el-button></template>
    </el-drawer>

  </div>
</template>

<style scoped>
.appium-node-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 6px 0; }
.appium-node-summary__text { display: grid; gap: 2px; min-width: 0; font-size: 12px; }
.appium-node-summary__text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.appium-node-summary__text span, .appium-node-summary__empty { color: var(--el-text-color-secondary); font-size: 12px; }
:global(.appium-node-detail-drawer.el-drawer) { max-width: calc(100vw - 24px); border-left: 1px solid var(--ui-border); background: var(--ui-bg); box-shadow: -18px 0 48px rgb(15 23 42 / 18%); }
:global(.appium-node-detail-drawer .el-drawer__header) { min-height: 56px; margin: 0; padding: 16px 20px; border-bottom: 1px solid var(--ui-border); background: linear-gradient(180deg, #fff, #f8fafc); color: var(--ui-text); }
:global(.appium-node-detail-drawer .el-drawer__title) { font-size: 16px; font-weight: 650; }
:global(.appium-node-detail-drawer .el-drawer__body) { padding: 20px; background: var(--ui-bg); }
:global(.appium-node-detail-drawer .el-drawer__footer) { padding: 14px 20px; border-top: 1px solid var(--ui-border); background: #f8fafc; }
.appium-node-detail__content { display: grid; gap: 16px; }
.appium-node-detail__summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px; border: 1px solid #dbeafe; border-radius: var(--ui-radius); background: linear-gradient(135deg, #f8fbff, #eff6ff); box-shadow: var(--ui-shadow-card); }
.appium-node-detail__summary > div:first-child { display: grid; min-width: 0; gap: 5px; }
.appium-node-detail__summary span { color: var(--ui-text-muted); font-size: 12px; }
.appium-node-detail__summary strong { color: var(--ui-text); font-size: 16px; overflow-wrap: anywhere; }
.appium-node-detail__summary code { color: var(--ui-text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.appium-node-detail__tags { display: flex; flex: none; justify-content: flex-end; gap: 6px; flex-wrap: wrap; max-width: 220px; }
.appium-node-detail__panel { padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface); box-shadow: var(--ui-shadow-card); }
.appium-node-detail__panel--locators { padding: 12px; }
.appium-node-detail__panel--locators .appium-node-detail__heading { margin-bottom: 8px; }
.appium-node-detail__heading { display: grid; gap: 4px; margin-bottom: 12px; }
.appium-node-detail__heading strong { color: var(--ui-text); font-size: 14px; }
.appium-node-detail__heading span { color: var(--ui-text-muted); font-size: 12px; }
.appium-node-locators { display: grid; gap: 7px; }
.appium-node-locator-card { display: grid; gap: 6px; min-width: 0; padding: 9px 10px; border: 1px solid var(--ui-border); border-radius: 9px; background: #fbfcfe; box-shadow: 0 2px 6px rgb(15 23 42 / 5%); }
.appium-node-locator-card.is-recommended { border-color: #bfdbfe; background: linear-gradient(135deg, #f8fbff, #eff6ff); box-shadow: 0 0 0 2px rgb(26 115 232 / 8%), 0 4px 10px rgb(26 115 232 / 8%); }
.appium-node-locator-card__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.appium-node-locator-value { display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: center; gap: 6px; }
.appium-node-locator-value code { min-height: 26px; padding: 5px 8px; border: 1px solid rgb(203 213 225 / 65%); border-radius: 7px; background: #f1f5f9; color: var(--ui-text-secondary); font-size: 11px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
:deep(.el-descriptions__content) { overflow-wrap: anywhere; word-break: break-word; }
.appium-node-properties :deep(.el-descriptions__table) { table-layout: fixed; width: 100%; }
.appium-node-properties :deep(.el-descriptions__label) { width: 118px; overflow-wrap: anywhere; }
.appium-node-locator-label { display: inline-flex; align-items: baseline; gap: 6px; color: var(--ui-text); cursor: help; }
.appium-node-locator-label small { font-weight: 400; color: var(--el-text-color-secondary); }
.appium-node-locator-copy { width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 0; margin: 0; }
.appium-node-locator-warning { display: block; margin-top: 4px; color: var(--el-color-warning); }
@media (max-width: 520px) {
  :global(.appium-node-detail-drawer .el-drawer__body) { padding: 14px; }
  .appium-node-detail__summary { display: grid; padding: 14px; }
  .appium-node-detail__tags { justify-content: flex-start; max-width: none; }
  .appium-node-detail__panel { padding: 12px; }
}
</style>
