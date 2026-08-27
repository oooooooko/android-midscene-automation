<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, type EdgeProps } from '@vue-flow/core';
import type { FlowGraphNodeData } from '../flow-graph';

const props = defineProps<EdgeProps>();

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
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;

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
