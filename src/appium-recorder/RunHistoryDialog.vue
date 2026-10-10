<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Delete, Refresh, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { historyStatistics, type RunSummary, type RunDetail } from './run-history';

const props = defineProps<{ scriptId: string; scriptName: string }>();
const emit = defineEmits<{ close: [] }>();
const runs = ref<RunSummary[]>([]);
const selected = ref<RunSummary[]>([]);
const details = ref<RunDetail[]>([]);
const loading = ref(false);
const comparing = ref(false);
const version = ref('');
const device = ref('');
const error = ref('');
const nodeKey = ref('');
const logQuery = ref('');
const videoRun = ref<RunSummary>();
const videoSegment = ref(0);
watch(videoRun, () => { videoSegment.value = 0; }, { flush: 'sync' });
const base = `/api/appium-recorder/scripts/${encodeURIComponent(props.scriptId)}/history`;
const labels = { passed: '通过', failed: '失败', stopped: '已终止' };
const versions = computed(() => [...new Set(runs.value.map(run => run.appVersion || '未知'))]);
const devices = computed(() => [...new Set(runs.value.map(run => run.deviceId))]);
const filtered = computed(() => runs.value.filter(run => (!version.value || (run.appVersion || '未知') === version.value) && (!device.value || run.deviceId === device.value)));
const stats = computed(() => historyStatistics(filtered.value));
const trend = computed(() => [...filtered.value].sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
const maxDuration = computed(() => Math.max(1, ...trend.value.map(run => run.durationMs)));
const points = computed(() => trend.value.map((run, index) => `${20 + index * 760 / Math.max(1, trend.value.length - 1)},${130 - run.durationMs / maxDuration.value * 110}`).join(' '));
const comparisonNodes = computed(() => [...new Map(details.value.flatMap(run => run.nodes.map(node => [node.key, node] as const))).values()]);
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const seconds = (value: number) => `${(value / 1000).toFixed(2)}s`;

async function request<T>(url: string, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method });
  if (!response.ok) throw new Error('历史结果请求失败');
  return response.json();
}
async function load() {
  loading.value = true; error.value = '';
  try { runs.value = await request<RunSummary[]>(base); selected.value = []; }
  catch (cause) { error.value = String(cause); }
  finally { loading.value = false; }
}
async function compare() {
  comparing.value = true;
  try {
    details.value = await Promise.all([...selected.value].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(run => request<RunDetail>(`${base}/${encodeURIComponent(run.id)}`)));
    nodeKey.value = '';
  } catch (cause) { ElMessage.error(String(cause)); }
  finally { comparing.value = false; }
}
async function remove() {
  try { await ElMessageBox.confirm(`删除选中的 ${selected.value.length} 条历史及截图、日志快照和回放视频？原始报告将无法再播放已删除的视频。`, '删除历史结果', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }); }
  catch { return; }
  loading.value = true;
  try {
    for (const run of selected.value) await request(`${base}/${encodeURIComponent(run.id)}`, 'DELETE');
    details.value = [];
    await load();
  } catch (cause) { ElMessage.error(String(cause)); await load(); }
  finally { loading.value = false; }
}
function nodeDuration(run: RunDetail) {
  const matches = run.nodes.filter(node => node.key === nodeKey.value);
  if (!matches.length) return '未执行';
  if (matches.some(node => node.durationMs === null)) return '耗时不完整';
  return seconds(matches.reduce((sum, node) => sum + (node.durationMs || 0), 0));
}
onMounted(load);
</script>

<template>
  <el-dialog :model-value="true" :title="`${scriptName} · 历史结果对比`" width="min(1200px, calc(100vw - 32px))" class="run-history-dialog" align-center append-to-body draggable overflow @closed="emit('close')">
    <div v-loading="loading" class="run-history">
      <div class="history-toolbar">
        <el-select v-model="version" clearable placeholder="全部应用版本" aria-label="应用版本"><el-option v-for="item in versions" :key="item" :value="item" /></el-select>
        <el-select v-model="device" clearable placeholder="全部设备" aria-label="设备"><el-option v-for="item in devices" :key="item" :value="item" /></el-select>
        <el-tooltip content="刷新历史"><el-button :icon="Refresh" aria-label="刷新历史" @click="load" /></el-tooltip>
        <el-button type="primary" :disabled="selected.length !== 2" :loading="comparing" @click="compare">对比两次运行</el-button>
        <el-tooltip content="删除选中历史"><el-button :icon="Delete" type="danger" plain :disabled="!selected.length" aria-label="删除选中历史" @click="remove" /></el-tooltip>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-empty v-else-if="!runs.length && !loading" description="暂无历史结果，后续运行会自动记录" />
      <template v-else>
        <div class="history-summary">
          <strong>{{ filtered.length }}</strong><span>次运行</span>
          <i />
          <strong>{{ stats.passRate === null ? '—' : `${(stats.passRate * 100).toFixed(1)}%` }}</strong><span>通过率（不含手动终止）</span>
        </div>
        <section class="history-panel">
          <h3>耗时趋势</h3>
          <svg class="history-trend" viewBox="0 0 800 160" role="img" aria-label="按时间从早到晚的运行耗时趋势">
            <path d="M20 10V130H790" fill="none" stroke="#a0a8ad" />
            <polyline :points="points" fill="none" stroke="#168a75" stroke-width="2" />
            <circle v-for="(run, index) in trend" :key="run.id" :cx="20 + index * 760 / Math.max(1, trend.length - 1)" :cy="130 - run.durationMs / maxDuration * 110" r="4" :fill="run.status === 'failed' ? '#d14343' : '#168a75'">
              <title>{{ time(run.startedAt) }} · {{ seconds(run.durationMs) }} · {{ run.appVersion || '未知版本' }}</title>
            </circle>
            <text x="24" y="14">{{ seconds(maxDuration) }}</text><text x="20" y="153">{{ trend[0] ? time(trend[0].startedAt) : '' }}</text><text x="780" y="153" text-anchor="end">{{ trend.length > 1 ? time(trend[trend.length - 1].startedAt) : '' }}</text>
          </svg>
        </section>
        <section class="history-panel">
          <h3>运行记录</h3>
          <el-table :data="filtered" row-key="id" max-height="270" @selection-change="selected = $event">
            <el-table-column type="selection" width="42" />
            <el-table-column label="运行时间" min-width="180"><template #default="{ row }">{{ time(row.startedAt) }}</template></el-table-column>
            <el-table-column prop="appVersion" label="应用版本" min-width="140"><template #default="{ row }">{{ row.appVersion || '未知' }}</template></el-table-column>
            <el-table-column prop="deviceId" label="设备" min-width="140" />
            <el-table-column label="结果" width="90"><template #default="{ row }"><el-tag :type="row.status === 'passed' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" size="small">{{ labels[row.status as keyof typeof labels] }}</el-tag></template></el-table-column>
            <el-table-column label="耗时" width="100"><template #default="{ row }">{{ seconds(row.durationMs) }}</template></el-table-column>
            <el-table-column label="录像" width="70"><template #default="{ row }"><el-tooltip v-if="row.video" content="播放回放视频"><el-button :icon="VideoPlay" text aria-label="播放回放视频" @click="videoRun = row" /></el-tooltip></template></el-table-column>
          </el-table>
        </section>
        <section class="history-panel">
          <h3>失败节点分布</h3>
          <el-table :data="stats.failures" max-height="220" empty-text="暂无节点失败记录">
            <el-table-column prop="label" label="节点" min-width="220" />
            <el-table-column label="失败 / 到达次数" width="145"><template #default="{ row }">{{ row.failures }} / {{ row.runs }}</template></el-table-column>
            <el-table-column label="观察结果" width="130"><template #default="{ row }">{{ row.runs < 2 ? '样本不足' : row.failures === row.runs ? '持续失败' : '偶发失败' }}</template></el-table-column>
            <el-table-column label="首次失败 / 版本" min-width="190"><template #default="{ row }">{{ time(row.firstFailure) }} · {{ row.version || '未知' }}</template></el-table-column>
          </el-table>
        </section>
      </template>
      <section v-if="details.length === 2" class="history-panel history-comparison">
        <div class="history-comparison__header"><h3>运行对比</h3><el-tag type="info">总耗时差 {{ seconds(details[1].durationMs - details[0].durationMs) }}</el-tag></div>
        <el-alert v-if="details[0].deviceId !== details[1].deviceId || details[0].appPackage !== details[1].appPackage" title="两次运行的设备或应用不同，耗时差不能直接归因于版本变化" type="warning" :closable="false" />
        <el-select v-model="nodeKey" clearable filterable placeholder="全部节点截图" aria-label="对比节点"><el-option v-for="node in comparisonNodes" :key="node.key" :label="node.label" :value="node.key" /></el-select>
        <div class="comparison-columns">
          <section v-for="run in details" :key="run.id" class="comparison-run-card">
            <div class="comparison-run-card__header"><h4>{{ time(run.startedAt) }}</h4><el-tag :type="run.status === 'passed' ? 'success' : run.status === 'failed' ? 'danger' : 'info'" size="small">{{ labels[run.status] }}</el-tag></div>
            <p class="comparison-run-card__meta">{{ run.appVersion || '未知版本' }} · {{ run.deviceId }} · {{ seconds(run.durationMs) }}</p>
            <p v-if="nodeKey" class="comparison-run-card__note">节点累计耗时（含截图开销）：{{ nodeDuration(run) }}</p>
            <p v-if="!run.frames.some(frame => !nodeKey || frame.key === nodeKey)" class="comparison-run-card__note">未捕获到对应截图</p>
            <div class="history-frames">
              <figure v-for="(frame, index) in run.frames.filter(frame => !nodeKey || frame.key === nodeKey)" :key="index">
                <figcaption>{{ frame.label }} · {{ frame.phase === 'before' ? '执行前' : frame.phase === 'after' ? '执行后' : frame.phase === 'observation' ? '观察采样' : frame.phase }} · {{ time(frame.capturedAt) }}</figcaption>
                <el-image :src="frame.imageUrl" :preview-src-list="[frame.imageUrl]" preview-teleported fit="contain" loading="lazy" />
              </figure>
            </div>
            <h4>节点结果</h4><ul class="history-node-results"><li v-for="(node, index) in run.nodes.filter(node => !nodeKey || node.key === nodeKey)" :key="index">{{ node.label }} · {{ node.failed ? '失败' : '完成' }} · {{ node.durationMs === null ? '耗时未知' : seconds(node.durationMs) }}</li></ul>
            <h4>关键日志 / 完整日志</h4><el-input v-model="logQuery" class="history-log-search" clearable placeholder="日志关键字，如 stageLog" aria-label="日志关键字" /><pre class="history-log-output">{{ logQuery ? run.output.split('\n').filter(line => line.toLowerCase().includes(logQuery.toLowerCase())).join('\n') || '无匹配日志' : run.output }}</pre>
          </section>
        </div>
      </section>
    </div>
    <el-dialog :model-value="Boolean(videoRun)" title="回放视频" width="min(800px, 90vw)" align-center append-to-body destroy-on-close @close="videoRun = undefined">
      <el-select v-if="videoRun?.video?.segments?.length" v-model="videoSegment" aria-label="视频片段" style="width:100%;margin-bottom:12px">
        <el-option v-for="(segment, index) in videoRun.video.segments" :key="segment.fileName" :label="`${index + 1}. ${segment.scriptName || videoRun.scriptName}`" :value="index" />
      </el-select>
      <video v-if="videoRun" :src="`${base}/${encodeURIComponent(videoRun.id)}/video?segment=${videoSegment}`" controls preload="metadata" style="width:100%;max-height:70vh" />
    </el-dialog>
    <template #footer><el-button type="primary" @click="emit('close')">关闭</el-button></template>
  </el-dialog>
</template>

<style scoped>
:global(.run-history-dialog.el-dialog) { display: flex; flex-direction: column; max-height: calc(100dvh - 32px); overflow: hidden; padding: 0; }
:global(.run-history-dialog > .el-dialog__body) { flex: 1; min-height: 0; overflow: hidden; padding: 20px; }
.run-history { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; overflow: auto; padding: 1px 8px 12px 1px; scrollbar-gutter: stable; }
.history-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); background: var(--ui-bg-soft); box-shadow: var(--ui-shadow-inset); }
.history-toolbar .el-select { width: 190px; }
.history-summary { display: flex; align-items: baseline; gap: 6px; padding: 12px 16px; border: 1px solid #dbeafe; border-radius: var(--ui-radius-control); background: #eff6ff; color: var(--ui-text-secondary); font-size: 13px; }
.history-summary strong { color: var(--ui-primary); font-size: 20px; line-height: 1; }
.history-summary i { align-self: stretch; width: 1px; margin: 0 8px; background: #bfdbfe; }
.history-panel { padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface); box-shadow: var(--ui-shadow-card); }
.history-trend { display: block; box-sizing: border-box; width: 100%; height: 160px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); background: linear-gradient(180deg, #f8fafc, #f3faf7); box-shadow: var(--ui-shadow-inset); }
.history-trend text { font-size: 12px; fill: #52615b; }
h3 { margin: 0 0 12px; color: var(--ui-text); font-size: 15px; }
h4 { margin: 16px 0 8px; color: var(--ui-text); font-size: 14px; }
.history-comparison { display: grid; gap: 14px; }
.history-comparison__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.history-comparison__header h3 { margin: 0; }
.history-comparison > .el-select { width: 100%; }
.comparison-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.comparison-run-card { min-width: 0; padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); background: #fbfcfe; box-shadow: 0 3px 10px rgb(15 23 42 / 6%); overflow-wrap: anywhere; }
.comparison-run-card__header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.comparison-run-card__header h4 { margin: 0; }
.comparison-run-card__meta { margin: 6px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.comparison-run-card__note { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--ui-bg-soft); color: var(--ui-text-secondary); font-size: 12px; }
.history-frames { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; max-height: 360px; overflow: auto; padding: 2px; }
figure { margin: 0; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-surface); box-shadow: 0 2px 6px rgb(15 23 42 / 6%); }
figcaption { min-height: 34px; padding: 8px 10px; border-bottom: 1px solid var(--ui-border); background: var(--ui-bg-soft); color: var(--ui-text-secondary); font-size: 12px; line-height: 1.5; }
.el-image { display: block; width: 100%; height: 150px; }
.history-node-results { box-sizing: border-box; max-height: 160px; margin: 0; overflow: auto; padding: 10px 12px 10px 30px; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-surface); color: var(--ui-text-secondary); font-size: 12px; line-height: 1.8; }
.history-log-search { margin-bottom: 10px; }
.history-log-output { box-sizing: border-box; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; margin: 0; padding: 12px; border: 1px solid #3c3c3c; border-radius: 6px; background: #1e1e1e; box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 4px 12px rgb(0 0 0 / 32%), 0 4px 10px rgb(15 23 42 / 12%), 0 18px 30px -20px rgb(15 23 42 / 45%); color: #d4d4d4; font: 12px/1.6 "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; scrollbar-color: #424242 #1e1e1e; }
.history-log-output::-webkit-scrollbar { width: 10px; height: 10px; }
.history-log-output::-webkit-scrollbar-track { background: #1e1e1e; }
.history-log-output::-webkit-scrollbar-thumb { border: 2px solid #1e1e1e; border-radius: 6px; background: #424242; }
.history-log-output::-webkit-scrollbar-thumb:hover { background: #4f4f4f; }
.history-log-output::selection { background: #264f78; color: #fff; }
@media (max-width: 760px) {
  :global(.run-history-dialog > .el-dialog__body) { padding: 14px; }
  .run-history { padding-right: 3px; }
  .history-toolbar .el-select { width: 100%; }
  .history-summary { flex-wrap: wrap; }
  .history-summary i { display: none; }
  .history-panel { padding: 12px; }
  .comparison-columns { grid-template-columns: minmax(0, 1fr); }
  .history-frames { grid-template-columns: minmax(0, 1fr); }
}
</style>
