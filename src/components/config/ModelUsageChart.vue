<script setup lang="ts">
import { computed } from 'vue';
import type { ModelUsageRecord } from '../../types';

const CHART_WIDTH = 720;
const CHART_HEIGHT = 180;
const CHART_PADDING = 28;

const props = defineProps<{
  records: ModelUsageRecord[];
}>();

type ChartPoint = {
  x: number;
  y: number;
};

const recentRecords = computed(() => props.records.slice(-20));
const displayRecords = computed(() => recentRecords.value.slice().reverse());
const latestRecord = computed(() => recentRecords.value[recentRecords.value.length - 1]);
const tokenRecords = computed(() =>
  recentRecords.value.filter((record) => typeof record.totalTokens === 'number'),
);

const maxDurationMs = computed(() =>
  Math.max(1, ...recentRecords.value.map((record) => record.durationMs)),
);

const maxTotalTokens = computed(() =>
  Math.max(
    1,
    ...tokenRecords.value.flatMap((record) => [
      record.promptTokens || 0,
      record.completionTokens || 0,
      record.totalTokens || 0,
    ]),
  ),
);

const buildPoints = (records: ModelUsageRecord[], valueOf: (record: ModelUsageRecord) => number, maxValue: number) => {
  const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  return records.map<ChartPoint>((record, index) => {
    const count = Math.max(1, records.length - 1);
    return {
      x: CHART_PADDING + (plotWidth * index) / count,
      y: CHART_HEIGHT - CHART_PADDING - (plotHeight * valueOf(record)) / maxValue,
    };
  });
};

const durationPoints = computed(() =>
  buildPoints(recentRecords.value, (record) => record.durationMs, maxDurationMs.value),
);

const promptTokenPoints = computed(() =>
  buildPoints(tokenRecords.value, (record) => record.promptTokens || 0, maxTotalTokens.value),
);

const completionTokenPoints = computed(() =>
  buildPoints(tokenRecords.value, (record) => record.completionTokens || 0, maxTotalTokens.value),
);

const toPolyline = (points: ChartPoint[]) =>
  points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

const durationPolyline = computed(() => toPolyline(durationPoints.value));
const promptTokenPolyline = computed(() => toPolyline(promptTokenPoints.value));
const completionTokenPolyline = computed(() => toPolyline(completionTokenPoints.value));

const tokenLabel = (value?: number) => (typeof value === 'number' ? String(value) : '未返回');

const formatTime = (isoTime: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(isoTime));
</script>

<template>
  <section class="model-usage-chart">
    <div class="panel-header panel-header--sub">
      <div class="panel-header__title">
        <span>测试消耗统计</span>
      </div>
    </div>

    <div v-if="recentRecords.length" class="model-usage-chart__body">
      <div class="model-usage-chart__summary">
        <span>最近 {{ recentRecords.length }} 次</span>
        <span>最新耗时 {{ latestRecord?.durationMs || 0 }}ms</span>
        <span>输入 {{ tokenLabel(latestRecord?.promptTokens) }}</span>
        <span>输出 {{ tokenLabel(latestRecord?.completionTokens) }}</span>
        <span>总计 {{ tokenLabel(latestRecord?.totalTokens) }}</span>
      </div>

      <svg
        class="model-usage-chart__svg"
        :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`"
        role="img"
        aria-label="测试模型消耗统计曲线"
      >
        <line
          :x1="CHART_PADDING"
          :y1="CHART_HEIGHT - CHART_PADDING"
          :x2="CHART_WIDTH - CHART_PADDING"
          :y2="CHART_HEIGHT - CHART_PADDING"
          class="model-usage-chart__axis"
        />
        <line
          :x1="CHART_PADDING"
          :y1="CHART_PADDING"
          :x2="CHART_PADDING"
          :y2="CHART_HEIGHT - CHART_PADDING"
          class="model-usage-chart__axis"
        />
        <polyline
          v-if="promptTokenPolyline"
          :points="promptTokenPolyline"
          class="model-usage-chart__line model-usage-chart__line--prompt"
        />
        <polyline
          v-if="completionTokenPolyline"
          :points="completionTokenPolyline"
          class="model-usage-chart__line model-usage-chart__line--completion"
        />
        <polyline
          :points="durationPolyline"
          class="model-usage-chart__line model-usage-chart__line--duration"
        />
        <circle
          v-for="point in promptTokenPoints"
          :key="`prompt-${point.x}-${point.y}`"
          :cx="point.x"
          :cy="point.y"
          r="3"
          class="model-usage-chart__point model-usage-chart__point--prompt"
        />
        <circle
          v-for="point in completionTokenPoints"
          :key="`completion-${point.x}-${point.y}`"
          :cx="point.x"
          :cy="point.y"
          r="3"
          class="model-usage-chart__point model-usage-chart__point--completion"
        />
        <circle
          v-for="point in durationPoints"
          :key="`duration-${point.x}-${point.y}`"
          :cx="point.x"
          :cy="point.y"
          r="3"
          class="model-usage-chart__point model-usage-chart__point--duration"
        />
      </svg>

      <div class="model-usage-chart__legend">
        <span><i class="model-usage-chart__swatch model-usage-chart__swatch--prompt"></i>输入 tokens</span>
        <span><i class="model-usage-chart__swatch model-usage-chart__swatch--completion"></i>输出 tokens</span>
        <span><i class="model-usage-chart__swatch model-usage-chart__swatch--duration"></i>耗时 ms</span>
      </div>

      <div class="model-usage-chart__records">
        <div class="model-usage-chart__record model-usage-chart__record--head">
          <span>时间</span>
          <span>状态</span>
          <span>模型</span>
          <span>输入</span>
          <span>输出</span>
          <span>总计</span>
          <span>耗时</span>
        </div>
        <div v-for="record in displayRecords" :key="record.id" class="model-usage-chart__record">
          <span>{{ formatTime(record.createdAt) }}</span>
          <span>{{ record.success ? '成功' : '失败' }}</span>
          <span>{{ record.modelName }}</span>
          <span>{{ tokenLabel(record.promptTokens) }}</span>
          <span>{{ tokenLabel(record.completionTokens) }}</span>
          <span>{{ tokenLabel(record.totalTokens) }}</span>
          <span>{{ record.durationMs }}ms</span>
        </div>
      </div>
    </div>

    <el-empty v-else description="测试 AI 生成模型或生成脚本后显示消耗曲线" />
  </section>
</template>
