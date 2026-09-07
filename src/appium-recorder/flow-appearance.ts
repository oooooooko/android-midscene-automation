import type { InjectionKey, Ref } from 'vue';

export const DEFAULT_FLOW_BACKGROUND = '#d4e8dd';
export const FLOW_BACKGROUND_PRESETS = ['#d4e8dd', '#d5e6f5', '#e4dcf2', '#f2dedc', '#d5eae9', '#e8e4cc'];
export const flowBackgroundKey: InjectionKey<Readonly<Ref<string>>> = Symbol('flowBackground');

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim());
}

export function normalizeFlowBackground(value: unknown) {
  if (!isHexColor(value)) return DEFAULT_FLOW_BACKGROUND;
  const color = value.trim().toLowerCase();
  return color.length === 4 ? '#' + [...color.slice(1)].map((char) => char + char).join('') : color;
}
