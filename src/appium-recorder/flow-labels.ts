import type { FlowBranch, FlowKind } from './flow-graph';
import type { AppiumRecordedStep } from './types';
import { visualChangeMeta } from './visual-change';
import { longPressMode } from './long-press';
import { isNativeStateCondition } from './native-control-state';
import { DEFAULT_LOG_PREFIX } from './stage-log';
import { imageCheckSummary } from './image-check';
import { isAiBranchEnabled } from './ai-recognition';

export function isBooleanCondition(step: Pick<AppiumRecordedStep, 'type' | 'aiBranchEnabled'>) {
  return isNativeStateCondition(step) || (step.type === 'aiRecognition' && isAiBranchEnabled(step)) || step.type === 'textClick' || step.type === 'imageCheck';
}

export function defaultFlowKind(step: AppiumRecordedStep): FlowKind {
  if (step.type === 'aiRecognition') return isAiBranchEnabled(step) ? 'condition' : 'action';
  if (step.type === 'extractVariable') return 'action';
  if (step.type === 'loop') return 'condition';
  if (step.type === 'breakLoop' || step.type === 'continueLoop') return 'action';
  if (step.type === 'log' || step.type === 'openGallery' || step.type === 'endFlow') return 'action';
  if (isBooleanCondition(step)) return 'condition';
  if (step.flow?.nodeKind) return step.flow.nodeKind;
  if (step.type === 'assertExists' || step.type === 'assertText' || step.type === 'visualChange') return 'assertion';
  return 'action';
}

export function flowBranchLabel(step: Pick<AppiumRecordedStep, 'type'>, branch: FlowBranch) {
  if (step.type === 'loop') return branch === 'yes' ? '循环体' : '循环结束';
  if (step.type === 'textClick') return branch === 'yes' ? '匹配到文字' : '未匹配到文字';
  if (isBooleanCondition(step)) return branch === 'yes' ? 'true' : 'false';
  return branch === 'yes' ? '是' : '否';
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
    checkboxState: 'Checkbox 状态',
    checkedState: '判断勾选',
    radioButtonState: 'RadioButton 状态',
    aiRecognition: 'AI 识别',
    imageCheck: '图像判断',
    textClick: '文字点击',
    assertText: '断言文本',
    key: '按键',
    waitActivity: '等待 Activity',
    delay: '延时',
    coordinateTap: '坐标点击',
    swipe: '滑动',
    screenshot: '截图',
    launchApp: '启动 APP',
    stopApp: '杀死 APP',
    openGallery: '启动相册',
    endFlow: '终止流程',
    loop: '有界循环',
    breakLoop: '退出循环',
    continueLoop: '继续下一次循环',
    clearAppData: '清理 APP 缓存',
    longPress: '长按',
    pinch: '双指缩放',
    runScript: '连接脚本',
    noop: '空节点',
    log: '输出日志',
    extractVariable: '提取变量',
    visualChange: '检测画面变化',
  };
  return labelMap[step.type] || step.type;
}

export function flowStepMeta(step: AppiumRecordedStep) {
  if (step.type === 'imageCheck') return imageCheckSummary(step.imageCheck);
  if (step.type === 'extractVariable') return `${step.extractVariable?.attribute || 'text'} → ${step.extractVariable?.name || '未设置变量名'}`;
  if (step.type === 'loop') return `最多 ${step.loop?.maxIterations ?? '?'} 次 · ${step.loop?.exitWhen === 'exists' ? '元素出现时退出' : step.loop?.exitWhen === 'notExists' ? '元素消失时退出' : '固定次数'}${step.loop?.exitWhen !== 'never' ? ` ${step.selector?.value || ''}` : ''}`;
  if (step.type === 'breakLoop') return step.breakLoopTargetId ? '退出指定循环，继续循环结束后的流程' : '退出当前循环，继续循环结束后的流程';
  if (step.type === 'continueLoop') return step.continueLoopTargetId ? '结束本轮，进入指定循环的下一轮' : '结束本轮，进入当前循环的下一轮';
  if (step.type === 'log') return `${step.logPrefix ?? DEFAULT_LOG_PREFIX}:${step.value || ''}`;
  if (step.type === 'aiRecognition') return `AI ${step.aiObservation?.mode === 'untilMatch' ? '命中即结束' : step.aiObservation ? '持续观察' : '识别'} · ${step.value || '未填写识别内容'}${step.aiInvalidResultBranch ? ` · 无有效结果→${step.aiInvalidResultBranch === 'yes' ? 'true' : 'false'}` : ''}`;
  if (step.type === 'longPress') {
    const target = longPressMode(step) === 'element'
      ? `元素 ${step.selector?.strategy || ''} ${step.selector?.value || ''}`
      : `坐标 ${step.fallback?.centerX ?? ''},${step.fallback?.centerY ?? ''}`;
    return `${target} · ${step.timeoutMs ?? 800}ms`;
  }
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
  if (step.type === 'stopApp') return `${step.value || ''}（仅停止进程）`;
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
  if (step.type === 'coordinateTap') {
    return `${step.fallback?.centerX ?? ''},${step.fallback?.centerY ?? ''}`;
  }
  if (step.type === 'assertText') return step.value || '';
  return `${step.selector?.strategy || ''} ${step.selector?.value || ''}`.trim();
}

export function labelFlowStep(step: AppiumRecordedStep) {
  const meta = [
    flowKindLabel(defaultFlowKind(step)),
    flowTypeLabel(step),
    flowStepMeta(step),
  ].filter(Boolean).join(' · ');
  return {
    title: step.label,
    meta,
    note: step.note,
  };
}
