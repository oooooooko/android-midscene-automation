<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Collection, VideoPlay, CircleCheck, Warning } from '@element-plus/icons-vue';
import type { AnalysisResponse } from '../../analytics/summary';

const props = defineProps<{ data: AnalysisResponse }>();
const mode = ref<'daily' | 'monthly'>('daily');
const shown = ref({ midscene: true, appium: true });
const selectedPoint = ref<number | null>(null);
const engineColors = { midscene: '#4ea9ee', appium: '#13b8a6' };
const total = computed(() => {
  const { midscene: m, appium: a } = props.data;
  return { scripts: m.scripts + a.scripts, runs: m.runs + a.runs, passed: m.passed + a.passed, failed: m.failed + a.failed, stopped: m.stopped + a.stopped, running: m.running + a.running };
});
const passRate = computed(() => total.value.passed + total.value.failed ? `${(100 * total.value.passed / (total.value.passed + total.value.failed)).toFixed(1)}%` : '—');
const cards = computed(() => [
  { name: '测试脚本', value: total.value.scripts, note: `Midscene ${props.data.midscene.scripts} · Appium ${props.data.appium.scripts}`, icon: Collection, color: '#006be6' },
  { name: '执行次数', value: total.value.runs, note: `Midscene ${props.data.midscene.runs} · Appium ${props.data.appium.runs}`, icon: VideoPlay, color: '#13b8a6' },
  { name: '测试通过率', value: passRate.value, note: `通过 ${total.value.passed} 次 / 完成 ${total.value.passed + total.value.failed} 次`, icon: CircleCheck, color: '#67b92e' },
  { name: '失败次数', value: total.value.failed, note: `已停止 ${total.value.stopped} 次 · 运行中 ${total.value.running} 次`, icon: Warning, color: '#ed6a5e' },
]);
const points = computed(() => {
  const appium = new Map(props.data.appium[mode.value].map(point => [point.date, point.runs]));
  return props.data.midscene[mode.value].map(point => ({ date: point.date, midscene: point.runs, appium: appium.get(point.date) || 0 }));
});
const chartDescription = computed(() => props.data.days ? `所选最近 ${props.data.days} 天，按${mode.value === 'daily' ? '日' : '月'}汇总` : mode.value === 'daily' ? '最近 30 天，按日汇总' : '最近 12 个月，按月汇总');
const maxY = computed(() => Math.max(4, Math.ceil(Math.max(0, ...points.value.flatMap(point => [shown.value.midscene ? point.midscene : 0, shown.value.appium ? point.appium : 0])) / 4) * 4));
const x = (index: number) => 52 + index * 920 / Math.max(1, points.value.length - 1);
const y = (value: number) => 242 - value / maxY.value * 210;
function line(engine: 'midscene' | 'appium') {
  return points.value.map((point, index) => index === 0 ? `M ${x(index)} ${y(point[engine])}` : `C ${(x(index - 1) + x(index)) / 2} ${y(points.value[index - 1][engine])}, ${(x(index - 1) + x(index)) / 2} ${y(point[engine])}, ${x(index)} ${y(point[engine])}`).join(' ');
}
const labelIndices = computed(() => points.value.map((_, i) => i).filter(i => i % Math.max(1, Math.ceil((points.value.length - 1) / 10)) === 0 || i === points.value.length - 1));
const selected = computed(() => selectedPoint.value === null ? null : points.value[selectedPoint.value]);
watch(points, () => { selectedPoint.value = null; });
function navigatePoint(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  selectedPoint.value = event.key === 'Home' ? 0 : event.key === 'End' ? points.value.length - 1 : Math.max(0, Math.min(points.value.length - 1, (selectedPoint.value ?? -1) + (event.key === 'ArrowRight' ? 1 : -1)));
}
const distributions = computed(() => [
  { title: '引擎执行占比', center: '总执行次数', entries: [
    { name: 'Midscene', value: props.data.midscene.runs, color: engineColors.midscene },
    { name: 'Appium', value: props.data.appium.runs, color: engineColors.appium },
  ] },
  { title: '测试结果分布', center: '总执行次数', entries: [
    { name: '通过', value: total.value.passed, color: '#13b8a6' },
    { name: '失败', value: total.value.failed, color: '#ed6a5e' },
    { name: '已停止', value: total.value.stopped, color: '#a3a8b3' },
    { name: '运行中', value: total.value.running, color: '#f0b44b' },
  ] },
]);
const failures = computed(() => [
  ...props.data.midscene.rows.map(row => ({ ...row, engine: 'Midscene' })),
  ...props.data.appium.rows.map(row => ({ ...row, engine: 'Appium' })),
].filter(row => row.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 5));
function ringStyle(entries: { value: number; color: string }[]) {
  if (!total.value.runs) return { background: 'var(--ui-bg)' };
  let angle = 0;
  return { background: `conic-gradient(${entries.map(entry => {
    const start = angle;
    angle += entry.value / total.value.runs * 360;
    return `${entry.color} ${start}deg ${angle}deg`;
  }).join(', ')})` };
}
</script>

<template>
  <section class="analysis-charts" aria-label="测试数据图表">
    <div class="analysis-metrics">
      <article v-for="card in cards" :key="card.name" class="analysis-chart-card metric-card">
        <h2>{{ card.name }}</h2>
        <div class="metric-card__value"><strong>{{ card.value }}</strong><el-icon :style="{ color: card.color, backgroundColor: `${card.color}16` }"><component :is="card.icon" /></el-icon></div>
        <p>{{ card.note }}</p>
      </article>
    </div>

    <section class="analysis-chart-card trend-card" aria-label="测试执行趋势">
      <div class="chart-heading">
        <div class="trend-tabs" role="group" aria-label="趋势图时间粒度">
          <button :class="{ active: mode === 'daily' }" :aria-pressed="mode === 'daily'" @click="mode = 'daily'">执行趋势</button>
          <button :class="{ active: mode === 'monthly' }" :aria-pressed="mode === 'monthly'" @click="mode = 'monthly'">月执行量</button>
        </div>
        <div class="trend-legend">
          <button v-for="engine in (['midscene', 'appium'] as const)" :key="engine" :aria-pressed="shown[engine]" :class="{ muted: !shown[engine] }" @click="shown[engine] = !shown[engine]">
            <i :style="{ background: engineColors[engine] }" />{{ engine === 'midscene' ? 'Midscene' : 'Appium' }}
          </button>
        </div>
      </div>
      <div class="chart-caption"><span>{{ chartDescription }} · 执行次数</span><span role="status">{{ selected ? `${selected.date} · Midscene ${selected.midscene} 次 · Appium ${selected.appium} 次` : '悬停查看数据，聚焦图表后可用左右方向键切换' }}</span></div>
      <div class="trend-chart-scroll">
        <svg class="trend-chart" viewBox="0 0 1000 284" role="img" aria-label="Midscene 与 Appium 执行趋势，左右方向键查看日期数据" tabindex="0" @keydown="navigatePoint">
          <defs>
            <linearGradient id="midscene-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4ea9ee" stop-opacity=".45" /><stop offset="100%" stop-color="#4ea9ee" stop-opacity=".05" /></linearGradient>
            <linearGradient id="appium-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#13b8a6" stop-opacity=".4" /><stop offset="100%" stop-color="#13b8a6" stop-opacity=".05" /></linearGradient>
          </defs>
          <g v-for="tick in [0, 1, 2, 3, 4]" :key="tick">
            <rect v-if="tick < 4 && tick % 2 === 0" x="52" :y="y((tick + 1) * maxY / 4)" width="920" height="52.5" fill="var(--ui-bg-soft)" />
            <line x1="52" x2="972" :y1="y(tick * maxY / 4)" :y2="y(tick * maxY / 4)" stroke="var(--ui-border)" />
            <text x="42" :y="y(tick * maxY / 4) + 4" text-anchor="end">{{ tick * maxY / 4 }}</text>
          </g>
          <g v-for="index in labelIndices" :key="index">
            <line :x1="x(index)" :x2="x(index)" y1="32" y2="242" stroke="var(--ui-border)" stroke-dasharray="3 4" />
            <text :x="x(index)" y="267" text-anchor="middle">{{ points[index].date.slice(mode === 'daily' ? 5 : 2) }}</text>
          </g>
          <template v-for="engine in (['midscene', 'appium'] as const)" :key="engine">
            <g v-if="shown[engine] && points.length">
              <path :d="`${line(engine)} L ${x(points.length - 1)} 242 L 52 242 Z`" :fill="`url(#${engine}-trend-fill)`" />
              <path :d="line(engine)" fill="none" :stroke="engineColors[engine]" stroke-width="2.5" />
              <circle v-for="(point, index) in points" :key="point.date" :cx="x(index)" :cy="y(point[engine])" :r="selectedPoint === index ? 4 : 2.5" fill="white" :stroke="engineColors[engine]" stroke-width="1.5" />
            </g>
          </template>
          <line v-if="selectedPoint !== null" :x1="x(selectedPoint)" :x2="x(selectedPoint)" y1="32" y2="242" stroke="var(--ui-text-muted)" stroke-dasharray="4 4" />
          <rect v-for="(point, index) in points" :key="point.date" :x="Math.max(40, x(index) - 460 / Math.max(1, points.length - 1))" y="24" :width="920 / Math.max(1, points.length - 1)" height="224" fill="transparent" @mouseenter="selectedPoint = index">
            <title>{{ point.date }}：Midscene {{ point.midscene }} 次，Appium {{ point.appium }} 次</title>
          </rect>
          <text v-if="!points.some(point => point.midscene || point.appium)" x="512" y="126" text-anchor="middle">此时间范围暂无执行记录</text>
        </svg>
      </div>
    </section>

    <div class="analysis-distributions">
      <section v-for="chart in distributions" :key="chart.title" class="analysis-chart-card distribution-card" :aria-label="chart.title">
        <h2>{{ chart.title }}</h2>
        <div class="distribution-card__body">
          <div class="donut" :style="ringStyle(chart.entries)" role="img" :aria-label="chart.entries.map(entry => `${entry.name} ${entry.value} 次`).join('，')">
            <div class="donut__center"><strong>{{ total.runs }}</strong><span>{{ total.runs ? chart.center : '暂无记录' }}</span></div>
          </div>
          <ul class="distribution-legend"><li v-for="entry in chart.entries" :key="entry.name"><span><i :style="{ background: entry.color }" />{{ entry.name }}</span><strong>{{ entry.value }}</strong><small>{{ total.runs ? `${(entry.value / total.runs * 100).toFixed(1)}%` : '—' }}</small></li></ul>
        </div>
      </section>
      <section class="analysis-chart-card failures-card" aria-label="失败次数排行">
        <h2>失败次数排行 <small>TOP 5</small></h2>
        <div v-if="!failures.length" class="chart-empty">所选范围暂无失败记录</div>
        <ol v-else class="failure-bars"><li v-for="(row, index) in failures" :key="`${row.engine}-${row.id}`">
          <div><span :title="row.name">{{ index + 1 }}. {{ row.name }}</span><strong>{{ row.failed }} 次</strong></div>
          <div class="failure-bars__track"><span :style="{ width: `${row.failed / failures[0].failed * 100}%` }" /></div>
          <small>{{ row.engine }}</small>
        </li></ol>
      </section>
    </div>
  </section>
</template>

<style scoped>
.analysis-charts { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.analysis-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
.analysis-chart-card { padding: 22px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface); min-width: 0; }
h2 { margin: 0; font-size: 16px; font-weight: 600; }
.metric-card__value { display: flex; justify-content: space-between; align-items: center; margin: 24px 0; }
.metric-card__value > strong { font-size: 30px; font-weight: 600; font-variant-numeric: tabular-nums; }
.metric-card__value .el-icon { width: 44px; height: 44px; border-radius: 12px; font-size: 24px; }
.metric-card p { margin: 0; color: var(--ui-text-secondary); font-size: 12px; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.trend-tabs { display: flex; padding: 4px; border-radius: 6px; background: var(--ui-bg); }
.trend-tabs button, .trend-legend button { cursor: pointer; border: 0; background: transparent; color: var(--ui-text-secondary); font-size: 13px; padding: 6px 12px; }
.trend-tabs button.active { background: var(--ui-surface); color: var(--ui-text); border-radius: 4px; box-shadow: 0 1px 3px #00000012; }
.trend-legend { display: flex; gap: 8px; }
.trend-legend button { display: flex; align-items: center; gap: 8px; }
.trend-legend .muted { opacity: .4; }
i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex: none; }
.chart-caption { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; color: var(--ui-text-secondary); font-size: 12px; margin-top: 18px; min-height: 18px; }
.trend-chart-scroll { overflow-x: auto; }
.trend-chart { display: block; width: 100%; min-width: 600px; margin-top: 8px; }
.trend-chart text { fill: var(--ui-text-secondary); font-size: 12px; }
.trend-chart:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: -2px; border-radius: 4px; }
.analysis-distributions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.distribution-card__body { display: flex; align-items: center; flex-direction: column; gap: 22px; padding-top: 24px; }
.donut { display: grid; place-items: center; width: 176px; aspect-ratio: 1; border-radius: 50%; }
.donut__center { width: 124px; height: 124px; background: var(--ui-surface); border-radius: 50%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; }
.donut__center strong { font-size: 27px; font-weight: 600; }
.donut__center span { font-size: 12px; color: var(--ui-text-secondary); }
.distribution-legend { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; width: 100%; max-width: 260px; }
.distribution-legend li { display: grid; grid-template-columns: 1fr 36px 54px; gap: 8px; align-items: center; font-size: 13px; }
.distribution-legend li > span { display: flex; align-items: center; gap: 8px; }
.distribution-legend strong, .distribution-legend small { text-align: right; font-variant-numeric: tabular-nums; }
.distribution-legend small, .failure-bars small { color: var(--ui-text-secondary); }
.failures-card h2 small { margin-left: 6px; font-size: 11px; font-weight: 400; color: var(--ui-text-muted); }
.failure-bars { padding: 0; margin: 26px 0 0; list-style: none; display: grid; gap: 16px; }
.failure-bars li > div:first-child { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
.failure-bars li > div:first-child > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.failure-bars strong { font-size: 12px; white-space: nowrap; font-weight: 500; }
.failure-bars__track { height: 6px; border-radius: 3px; background: var(--ui-bg); margin: 7px 0 3px; overflow: hidden; }
.failure-bars__track > span { display: block; height: 100%; background: #4ea9ee; border-radius: inherit; }
.failure-bars small { font-size: 11px; }
.chart-empty { display: grid; place-items: center; min-height: 240px; color: var(--ui-text-muted); font-size: 13px; }
@media (max-width: 1200px) { .analysis-metrics { gap: 12px; } .analysis-chart-card { padding: 18px; } .analysis-distributions { gap: 12px; } }
@media (max-width: 1000px) { .analysis-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .analysis-distributions { grid-template-columns: 1fr; } .distribution-card__body { flex-direction: row; justify-content: space-evenly; flex-wrap: wrap; } }
</style>
