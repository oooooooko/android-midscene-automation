<script setup lang="ts">
import { computed, inject } from 'vue';
import { BaseEdge, getBezierPath, type EdgeProps } from '@vue-flow/core';
import { flowLineStyleKey, normalizeFlowLineStyle } from '../flow-appearance';
import type { FlowGraphNodeData } from '../flow-graph';

const props = defineProps<EdgeProps>();
const lineStyle = inject(flowLineStyleKey, computed(() => normalizeFlowLineStyle(undefined)));

const targetData = computed(() => props.targetNode.data as FlowGraphNodeData | undefined);

type Point = {
  x: number;
  y: number;
};

function linePath(points: Point[]) {
  if (points.length < 2) return '';
  const [start, ...rest] = points;
  return [
    `M ${start.x} ${start.y}`,
    ...rest.map((point) => `L ${point.x} ${point.y}`),
  ].join(' ');
}

const path = computed(() => {
  if (lineStyle.value === 'curved') {
    if (props.data?.merge && props.targetY > props.sourceY) {
      // 先沿分支向下，仅在汇合点上方的留白内弯曲，避免斜穿相邻节点。
      const bendY = Math.max(props.sourceY, props.targetY - 112);
      const controlY = (bendY + props.targetY) / 2;
      return [
        `M ${props.sourceX} ${props.sourceY}`,
        `L ${props.sourceX} ${bendY}`,
        `C ${props.sourceX} ${controlY} ${props.targetX} ${controlY} ${props.targetX} ${props.targetY}`,
      ].join(' ');
    }
    return getBezierPath({
      sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
      targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
    })[0];
  }
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;

  if (props.data?.merge && deltaY > 0) {
    // 同一公共节点的入边共用横线高度，不能随各分支的长度变化。
    const joinY = target.y - 24;
    return linePath([source, { x: source.x, y: joinY }, { x: target.x, y: joinY }, target]);
  }

  if (targetData.value?.kind === 'branch') {
    const direction = deltaY >= 0 ? 1 : -1;
    const branchY = source.y + direction * Math.min(Math.max(Math.abs(deltaY) * 0.45, 18), 34);
    return linePath([
      source,
      { x: source.x, y: branchY },
      { x: target.x, y: branchY },
      target,
    ]);
  }

  if (Math.abs(deltaX) < 2) {
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }

  const verticalGap = Math.min(Math.max(Math.abs(deltaY) * 0.38, 28), 56);
  const splitY = deltaY >= 0
    ? source.y + verticalGap
    : source.y - verticalGap;

  return linePath([
    source,
    { x: source.x, y: splitY },
    { x: target.x, y: splitY },
    target,
  ]);
});
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    :interaction-width="interactionWidth"
  />
</template>
