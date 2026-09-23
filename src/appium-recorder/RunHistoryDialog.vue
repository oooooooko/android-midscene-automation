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
  <el-dialog :model-value="true" :title="`${scriptName} · 历史结果对比`" width="min(1200px, 96vw)" align-center append-to-body @closed="emit('close')">
    <div v-loading="loading" class="run-history">
      <div class="history-toolbar">
        <el-select v-model="version" clearable placeholder="全部应用版本" aria-label="应用版本"><el-option v-for="item in versions" :key="item" :value="item" /></el-select>
        <el-select v-model="device" clearable placeholder="全部设备" aria-label="设备"><el-option v-for="item in devices" :key="item" :value="item" /></el-select>
        <el-tooltip content="刷新历史"><el-button :icon="Refresh" aria-label="刷新历史" @click="load" /></el-tooltip>
        <el-button :disabled="selected.length !== 2" :loading="comparing" @click="compare">对比两次运行</el-button>
        <el-tooltip content="删除选中历史"><el-button :icon="Delete" type="danger" plain :disabled="!selected.length" aria-label="删除选中历史" @click="remove" /></el-tooltip>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-empty v-else-if="!runs.length && !loading" description="暂无历史结果，后续运行会自动记录" />
      <template v-else>
        <p>{{ filtered.length }} 次运行 · 通过率 {{ stats.passRate === null ? '—' : `${(stats.passRate * 100).toFixed(1)}%` }}（不含手动终止）</p>
        <h3>耗时趋势</h3>
        <svg class="history-trend" viewBox="0 0 800 160" role="img" aria-label="按时间从早到晚的运行耗时趋势">
          <path d="M20 10V130H790" fill="none" stroke="#a0a8ad" />
          <polyline :points="points" fill="none" stroke="#168a75" stroke-width="2" />
          <circle v-for="(run, index) in trend" :key="run.id" :cx="20 + index * 760 / Math.max(1, trend.length - 1)" :cy="130 - run.durationMs / maxDuration * 110" r="4" :fill="run.status === 'failed' ? '#d14343' : '#168a75'">
            <title>{{ time(run.startedAt) }} · {{ seconds(run.durationMs) }} · {{ run.appVersion || '未知版本' }}</title>
          </circle>
          <text x="24" y="14">{{ seconds(maxDuration) }}</text><text x="20" y="153">{{ trend[0] ? time(trend[0].startedAt) : '' }}</text><text x="780" y="153" text-anchor="end">{{ trend.length > 1 ? time(trend[trend.length - 1].startedAt) : '' }}</text>
        </svg>
        <el-table :data="filtered" row-key="id" max-height="270" @selection-change="selected = $event">
          <el-table-column type="selection" width="42" />
          <el-table-column label="运行时间" min-width="180"><template #default="{ row }">{{ time(row.startedAt) }}</template></el-table-column>
          <el-table-column prop="appVersion" label="应用版本" min-width="140"><template #default="{ row }">{{ row.appVersion || '未知' }}</template></el-table-column>
          <el-table-column prop="deviceId" label="设备" min-width="140" />
          <el-table-column label="结果" width="85"><template #default="{ row }">{{ labels[row.status as keyof typeof labels] }}</template></el-table-column>
          <el-table-column label="耗时" width="100"><template #default="{ row }">{{ seconds(row.durationMs) }}</template></el-table-column>
          <el-table-column label="录像" width="70"><template #default="{ row }"><el-tooltip v-if="row.video" content="播放回放视频"><el-button :icon="VideoPlay" aria-label="播放回放视频" @click="videoRun = row" /></el-tooltip></template></el-table-column>
        </el-table>
        <h3>失败节点分布</h3>
        <el-table :data="stats.failures" max-height="220" empty-text="暂无节点失败记录">
          <el-table-column prop="label" label="节点" min-width="220" />
          <el-table-column label="失败 / 到达次数" width="145"><template #default="{ row }">{{ row.failures }} / {{ row.runs }}</template></el-table-column>
          <el-table-column label="观察结果" width="130"><template #default="{ row }">{{ row.runs < 2 ? '样本不足' : row.failures === row.runs ? '持续失败' : '偶发失败' }}</template></el-table-column>
          <el-table-column label="首次失败 / 版本" min-width="190"><template #default="{ row }">{{ time(row.firstFailure) }} · {{ row.version || '未知' }}</template></el-table-column>
        </el-table>
      </template>
      <section v-if="details.length === 2" class="history-comparison">
        <h3>运行对比 · 总耗时差 {{ seconds(details[1].durationMs - details[0].durationMs) }}</h3>
        <el-alert v-if="details[0].deviceId !== details[1].deviceId || details[0].appPackage !== details[1].appPackage" title="两次运行的设备或应用不同，耗时差不能直接归因于版本变化" type="warning" :closable="false" />
        <el-select v-model="nodeKey" clearable filterable placeholder="全部节点截图" aria-label="对比节点"><el-option v-for="node in comparisonNodes" :key="node.key" :label="node.label" :value="node.key" /></el-select>
        <div class="comparison-columns">
          <section v-for="run in details" :key="run.id">
            <h4>{{ time(run.startedAt) }} · {{ labels[run.status] }}</h4>
            <p>{{ run.appVersion || '未知版本' }} · {{ run.deviceId }} · {{ seconds(run.durationMs) }}</p>
            <p v-if="nodeKey">节点累计耗时（含截图开销）：{{ nodeDuration(run) }}</p>
            <p v-if="!run.frames.some(frame => !nodeKey || frame.key === nodeKey)">未捕获到对应截图</p>
            <div class="history-frames">
              <figure v-for="(frame, index) in run.frames.filter(frame => !nodeKey || frame.key === nodeKey)" :key="index">
                <figcaption>{{ frame.label }} · {{ frame.phase === 'before' ? '执行前' : frame.phase === 'after' ? '执行后' : frame.phase === 'observation' ? '观察采样' : frame.phase }} · {{ time(frame.capturedAt) }}</figcaption>
                <el-image :src="frame.imageUrl" :preview-src-list="[frame.imageUrl]" preview-teleported fit="contain" loading="lazy" />
              </figure>
            </div>
            <h4>节点结果</h4><ul><li v-for="(node, index) in run.nodes.filter(node => !nodeKey || node.key === nodeKey)" :key="index">{{ node.label }} · {{ node.failed ? '失败' : '完成' }} · {{ node.durationMs === null ? '耗时未知' : seconds(node.durationMs) }}</li></ul>
            <h4>关键日志 / 完整日志</h4><el-input v-model="logQuery" clearable placeholder="日志关键字，如 stageLog" aria-label="日志关键字" /><pre>{{ logQuery ? run.output.split('\n').filter(line => line.toLowerCase().includes(logQuery.toLowerCase())).join('\n') || '无匹配日志' : run.output }}</pre>
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
  </el-dialog>
</template>

<style scoped>
.run-history { max-height: 78vh; overflow: auto; }
.history-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.history-toolbar .el-select { width: 190px; }
.history-trend { width: 100%; height: 160px; background: #f3faf7; }
.history-trend text { font-size: 12px; fill: #52615b; }
h3 { font-size: 15px; margin: 18px 0 10px; }
h4 { font-size: 14px; margin: 12px 0 8px; }
.history-comparison > .el-select { width: 100%; }
.comparison-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
.comparison-columns section { min-width: 0; overflow-wrap: anywhere; }
.history-frames { max-height: 360px; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
figure { margin: 0; }
figcaption { font-size: 12px; }
.el-image { width: 100%; height: 150px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; background: #f1f5f4; padding: 10px; font-size: 12px; }
ul { max-height: 160px; overflow: auto; padding-left: 20px; }
@media (max-width: 650px) { .comparison-columns { grid-template-columns: minmax(0, 1fr); } }
</style>
