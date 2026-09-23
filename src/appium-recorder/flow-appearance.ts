import type { InjectionKey, Ref } from 'vue';

export const DEFAULT_FLOW_BACKGROUND = '#d4e8dd';
export const FLOW_BACKGROUND_PRESETS = ['#d4e8dd', '#d5e6f5', '#e4dcf2', '#f2dedc', '#d5eae9', '#e8e4cc'];
export const flowBackgroundKey: InjectionKey<Readonly<Ref<string>>> = Symbol('flowBackground');
export const DEFAULT_FLOW_LINE_COLOR = '#719985';
export const FLOW_LINE_COLOR_PRESETS = ['#719985', '#4b83c4', '#8b6bb1', '#c78a46', '#7b8794', '#374151'];
export const flowLineColorKey: InjectionKey<Readonly<Ref<string>>> = Symbol('flowLineColor');

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim());
}

export function normalizeFlowBackground(value: unknown) {
  return normalizeFlowColor(value, DEFAULT_FLOW_BACKGROUND);
}

export function normalizeFlowLineColor(value: unknown) {
  return normalizeFlowColor(value, DEFAULT_FLOW_LINE_COLOR);
}

function normalizeFlowColor(value: unknown, fallback: string) {
  if (!isHexColor(value)) return fallback;
  const color = value.trim().toLowerCase();
  return color.length === 4 ? '#' + [...color.slice(1)].map((char) => char + char).join('') : color;
}
