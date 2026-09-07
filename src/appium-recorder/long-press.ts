import type { AppiumRecordedStep } from './types';

export function longPressMode(step: Pick<AppiumRecordedStep, 'longPressMode'>) {
  // 旧脚本没有模式字段，继续使用录制坐标；新增节点显式设置为 element。
  return step.longPressMode ?? 'coordinates';
}

export function validateLongPress(step: AppiumRecordedStep) {
  const duration = step.timeoutMs ?? 800;
  if (!Number.isInteger(duration) || duration < 80) return '长按时间必须是至少 80 毫秒的整数';
  const mode = longPressMode(step);
  if (mode === 'element') {
    if (!step.selector || step.selector.strategy === 'bounds' || !step.selector.value?.trim()) {
      return '请设置有效的长按元素定位器';
    }
  } else if (mode === 'coordinates') {
    const point = step.fallback;
    if (point?.strategy !== 'bounds'
      || !Number.isFinite(point.centerX) || Number(point.centerX) < 0
      || !Number.isFinite(point.centerY) || Number(point.centerY) < 0) {
      return '请填写有效的长按坐标';
    }
  } else {
    return '长按方式无效';
  }
  return '';
}
