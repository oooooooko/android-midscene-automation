import type { AppiumRecordedStep } from './types';

export function textClickSelector(step: Pick<AppiumRecordedStep, 'value' | 'flow'>) {
  if (!step.value?.trim()) throw new Error('请输入要点击的文字');
  if (step.value.length > 1000) throw new Error('点击文字不能超过 1000 字');
  // JSON 字符串转义防止引号、反斜杠等内容改变 UiSelector 表达式。
  const method = step.flow?.textMatch === 'exact' ? 'text' : 'textContains';
  return { using: '-android uiautomator', value: `new UiSelector().${method}(${JSON.stringify(step.value)})` };
}
