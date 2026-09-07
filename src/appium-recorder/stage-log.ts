import type { AppiumRecordedStep } from './types';

export const DEFAULT_LOG_PREFIX = 'stageLog';
type LogStep = Pick<AppiumRecordedStep, 'logPrefix' | 'value'>;

export function validateStageLog(step: LogStep) {
  const prefix = step.logPrefix ?? DEFAULT_LOG_PREFIX;
  if (typeof prefix !== 'string' || !prefix.trim() || /[\r\n:：]/.test(prefix) || prefix.length > 100) {
    return '关键字不能为空，不能包含冒号或换行，最多 100 字';
  }
  if (typeof step.value !== 'string' || !step.value.trim()) return '请输入日志内容';
  if (step.value.length > 4000) return '日志内容不能超过 4000 字';
  return '';
}

export function formatStageLog(step: LogStep) {
  const error = validateStageLog(step);
  if (error) throw new Error(error);
  // 多行内容逐行添加关键字，便于搜索；内容仅作为文本，不执行插值或代码。
  return step.value!.split(/\r?\n/).map((line) => `${(step.logPrefix ?? DEFAULT_LOG_PREFIX).trim()}:${line}`).join('\n');
}
