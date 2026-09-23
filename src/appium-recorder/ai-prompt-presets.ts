import type { InjectionKey, Ref } from 'vue';
import { validateAiRecognitionPrompt } from './ai-recognition';

export type AiPromptPreset = { name: string; prompt: string };
export const DEFAULT_AI_PROMPT_PRESETS: readonly AiPromptPreset[] = [
  { name: '出图检测', prompt: '检测当前画面有没有出图？请排除黑屏、白屏和加载占位画面。' },
  { name: '广告及跳过关闭按钮检测', prompt: '检查当前画面有没有广告出现，并说明有没有跳过、关闭按钮。升级弹窗、通知弹窗不属于广告。' },
  { name: '广告内容提取', prompt: '识别当前广告的主要内容，并提取广告标题、产品名称和按钮文字。升级弹窗、通知弹窗不属于广告。' },
  { name: '异常提示检测', prompt: '当前画面是否出现网络异常、加载失败或错误提示？' },
];

export const aiPromptPresetsKey: InjectionKey<Readonly<Ref<readonly AiPromptPreset[]>>> = Symbol('aiPromptPresets');

export function resolveAiPromptPresets(value?: unknown): AiPromptPreset[] {
  // 缺少字段时使用默认场景；空数组保留用户删除结果；兼容旧版纯文本预设。
  if (value === undefined) return DEFAULT_AI_PROMPT_PRESETS.map(preset => ({ ...preset }));
  if (!Array.isArray(value)) throw new Error('AI 识别预设提示词必须是列表');
  const names = new Set<string>();
  const prompts = new Set<string>();
  return value.map((item, index) => {
    const legacy = typeof item === 'string';
    const prompt = validateAiRecognitionPrompt(legacy ? item : item?.prompt);
    const name = legacy
      ? DEFAULT_AI_PROMPT_PRESETS.find(preset => preset.prompt === prompt)?.name ?? `自定义场景 ${index + 1}`
      : typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) throw new Error('请输入测试场景名称');
    if (name.length > 80) throw new Error('测试场景名称不能超过 80 字');
    if (names.has(name)) throw new Error('测试场景名称已存在');
    if (prompts.has(prompt)) throw new Error('该提示词已存在');
    names.add(name);
    prompts.add(prompt);
    return { name, prompt };
  });
}
