import type { AppiumBounds, AppiumRecordedStep } from './types';

export const VISUAL_CHANGE_DEFAULTS = {
  durationMs: 5000,
  intervalMs: 1000,
  changeRatioThreshold: 2,
  pixelmatchThreshold: 0.1,
} as const;

export function createStepId() {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function boundsToVisualRegion(bounds: AppiumBounds) {
  return {
    x: bounds.left,
    y: bounds.top,
    width: Math.max(0, bounds.right - bounds.left),
    height: Math.max(0, bounds.bottom - bounds.top),
  };
}

export function normalizeVisualRegion(
  region: NonNullable<AppiumRecordedStep['visualChange']>['region'],
) {
  return {
    x: Math.max(0, Math.round(Number(region?.x) || 0)),
    y: Math.max(0, Math.round(Number(region?.y) || 0)),
    width: Math.max(1, Math.round(Number(region?.width) || 1)),
    height: Math.max(1, Math.round(Number(region?.height) || 1)),
  };
}

export function normalizeVisualChangeConfig(
  config?: AppiumRecordedStep['visualChange'],
): NonNullable<AppiumRecordedStep['visualChange']> {
  return {
    mode: config?.mode === 'selectedElement' ? 'selectedElement' : 'region',
    region: normalizeVisualRegion(config?.region || { x: 0, y: 0, width: 1, height: 1 }),
    role: config?.role === 'start' ? 'start' : config?.role === 'end' ? 'end' : undefined,
    pairId: config?.pairId || '',
    pairLabel: config?.pairLabel || '',
    startStepId: config?.startStepId || '',
    endStepId: config?.endStepId || '',
    durationMs: Math.max(1000, Math.round(Number(config?.durationMs) || VISUAL_CHANGE_DEFAULTS.durationMs)),
    intervalMs: Math.max(200, Math.round(Number(config?.intervalMs) || VISUAL_CHANGE_DEFAULTS.intervalMs)),
    changeRatioThreshold: Math.max(0.01, Number(config?.changeRatioThreshold) || VISUAL_CHANGE_DEFAULTS.changeRatioThreshold),
    pixelmatchThreshold: Math.min(
      1,
      Math.max(0, Number(config?.pixelmatchThreshold) || VISUAL_CHANGE_DEFAULTS.pixelmatchThreshold),
    ),
  };
}

export function visualRegionToBounds(
  id: string,
  region: NonNullable<AppiumRecordedStep['visualChange']>['region'],
) {
  const normalized = normalizeVisualRegion(region);
  return {
    id,
    left: normalized.x,
    top: normalized.y,
    right: normalized.x + normalized.width,
    bottom: normalized.y + normalized.height,
  };
}

export function visualChangeMeta(step: AppiumRecordedStep) {
  const config = normalizeVisualChangeConfig(step.visualChange);
  if (config.role === 'start') return `${config.pairLabel || '检测画面变化'} · 开始 · 阈值 ${config.changeRatioThreshold}%`;
  if (config.role === 'end') return `${config.pairLabel || '检测画面变化'} · 结束`;
  const range = config.startStepId && config.endStepId ? '起止节点截图对比' : '请选择起止节点';
  return `${range} · 阈值 ${config.changeRatioThreshold}%`;
}
