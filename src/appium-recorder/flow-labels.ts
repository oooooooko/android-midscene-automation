import type { FlowKind } from './flow-graph';
import type { AppiumRecordedStep } from './types';
import { visualChangeMeta } from './visual-change';

export function defaultFlowKind(step: AppiumRecordedStep): FlowKind {
  if (step.flow?.nodeKind) return step.flow.nodeKind;
  if (step.type === 'assertExists' || step.type === 'assertText' || step.type === 'visualChange') return 'assertion';
  return 'action';
}

export function flowKindLabel(kind: FlowKind) {
  return { action: '操作', condition: '判断', assertion: '校验' }[kind];
}

export function flowTypeLabel(step: AppiumRecordedStep) {
  const labelMap: Partial<Record<AppiumRecordedStep['type'], string>> = {
    tap: '点击',
    input: '输入',
    tapIfExists: '存在则点击',
    inputIfExists: '存在则输入',
    clearIfExists: '存在则清空',
    backIfExists: '存在则返回',
    clearInput: '清空',
    waitFor: '等待出现',
    waitDisappear: '等待消失',
    assertExists: '断言存在',
    assertText: '断言文本',
    key: '按键',
    waitActivity: '等待 Activity',
    delay: '延时',
    coordinateTap: '坐标点击',
    swipe: '滑动',
    screenshot: '截图',
    launchApp: '启动 APP',
    clearAppData: '清理 APP 缓存',
    longPress: '长按',
    pinch: '双指缩放',
    runScript: '连接脚本',
    noop: '空节点',
    visualChange: '检测画面变化',
  };
  return labelMap[step.type] || step.type;
}

export function flowStepMeta(step: AppiumRecordedStep) {
  if (step.type === 'delay') return `${step.timeoutMs || 1000}ms`;
  if (step.type === 'input' || step.type === 'inputIfExists') return `输入内容：${step.value || '空'}`;
  if (defaultFlowKind(step) === 'condition' && step.value) {
    return `${step.flow?.textMatch === 'exact' ? '精准匹配' : '模糊匹配'}：${step.value}`;
  }
  if (step.contextSelector && step.selector) {
    return `父级 ${step.contextSelector.strategy} ${step.contextSelector.value || ''} + 子级 ${step.selector.strategy} ${step.selector.value || ''}`;
  }
  if (step.type === 'key') return `keyCode ${step.keyCode || ''}`;
  if (step.type === 'waitActivity') return step.value || '';
  if (step.type === 'launchApp') return step.value || '';
  if (step.type === 'clearAppData') return `${step.value || ''}（清除数据与缓存）`;
  if (step.type === 'runScript') return step.value ? `脚本 ${step.value}` : '';
  if (step.type === 'noop') return '';
  if (step.type === 'screenshot') return '保存当前截图';
  if (step.type === 'visualChange') return visualChangeMeta(step);
  if (step.type === 'swipe') {
    const swipe = step.swipe;
    return swipe ? `[${swipe.startX},${swipe.startY}] -> [${swipe.endX},${swipe.endY}]` : '';
  }
  if (step.type === 'pinch') return step.pinch?.direction === 'out' ? '放大' : '缩小';
  if (step.type === 'longPress') {
    return `${step.fallback?.centerX || ''},${step.fallback?.centerY || ''} · ${step.timeoutMs || 800}ms`;
  }
  if (step.type === 'coordinateTap') {
    return `${step.fallback?.centerX || ''},${step.fallback?.centerY || ''}`;
  }
  if (step.type === 'assertText') return step.value || '';
  return `${step.selector?.strategy || ''} ${step.selector?.value || ''}`.trim();
}

export function labelFlowStep(step: AppiumRecordedStep) {
  const meta = [
    flowKindLabel(defaultFlowKind(step)),
    flowTypeLabel(step),
    step.optional ? '可选' : '',
    flowStepMeta(step),
  ].filter(Boolean).join(' · ');
  return {
    title: step.label,
    meta,
    note: step.note,
  };
}
