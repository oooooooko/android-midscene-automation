<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { getTestAnalytics } from '../api';
import type { AnalysisResponse } from '../analytics/summary';
import AnalysisCharts from '../components/analytics/AnalysisCharts.vue';
import ReportAnalysis from '../components/analytics/ReportAnalysis.vue';
const props = defineProps<{ active: boolean }>();
const days = shallowRef(0);
const data = shallowRef<AnalysisResponse | null>(null);
const loading = shallowRef(false);
const error = shallowRef('');
let requestId = 0;
async function refresh() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try { const result = await getTestAnalytics(days.value); if (id === requestId) data.value = result; }
  catch (reason) { if (id === requestId) error.value = reason instanceof Error ? reason.message : '统计数据加载失败'; }
  finally { if (id === requestId) loading.value = false; }
}
watch(() => props.active, active => { if (active) void refresh(); }, { immediate: true });
watch(days, () => { void refresh(); });
</script>

<template>
  <div class="analysis-page" :aria-busy="loading">
    <div class="analysis-page__heading">
      <div><h1>测试分析</h1><p>基于已保存脚本与测试执行记录，查看两种引擎的运行情况。</p></div>
      <div class="analysis-page__actions">
        <el-select v-model="days" aria-label="统计时间范围" style="width: 150px">
          <el-option label="全部时间" :value="0" /><el-option label="最近 7 天" :value="7" /><el-option label="最近 30 天" :value="30" /><el-option label="最近 90 天" :value="90" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新统计</el-button>
      </div>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button link type="primary" @click="refresh">重新加载</el-button></el-alert>
    <div v-if="loading && !data" class="page-loading" role="status">正在汇总测试记录…</div>
    <template v-if="data">
      <div class="analysis-page__note">
        <span>{{ data.days ? `最近 ${data.days} 天` : '全部时间' }} · 通过率 = 通过 ÷（通过 + 失败）；平均耗时仅统计已完成测试，停止和运行中单独列出。</span>
        <span>更新于 {{ new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false }) }}{{ loading ? ' · 更新中…' : '' }}</span>
      </div>
      <AnalysisCharts :data="data" />
      <ReportAnalysis title="Midscene" :summary="data.midscene" />
      <ReportAnalysis title="Appium" :summary="data.appium" />
      <p class="analysis-page__footnote">统计来自数据库中的执行记录，不依赖 HTML 报告开关。Midscene 按历史脚本名称关联，Appium 按脚本 ID 关联；已删除或无法匹配的记录标记为“历史脚本”。未保存执行记录的测试不计入统计。</p>
    </template>
  </div>
</template>

<style scoped>
.analysis-page { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.analysis-page__heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
h1 { margin: 0; font-size: 22px; font-weight: 600; }
.analysis-page__heading p { margin: 8px 0 0; color: var(--ui-text-secondary); font-size: 13px; }
.analysis-page__actions { display: flex; gap: 12px; }
.analysis-page__note { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--ui-text-secondary); }
.analysis-page__footnote { margin: 0; color: var(--ui-text-secondary); font-size: 12px; line-height: 1.8; }
</style>
