export type AiRecognitionModel = { baseUrl: string; apiKey: string; name: string };
export type AiRecognitionResult = { result: boolean; reason: string; durationMs: number };

export const AI_MODEL_CONFIG_HINT = '请在参数配置 > Appium配置中填写并保存 AI 识别模型的 Base URL、API Key 和 Model Name';

export function isAiRecognitionModelConfigured(model?: Partial<AiRecognitionModel> | null) {
  return Boolean(model && [model.baseUrl, model.apiKey, model.name].every(
    (value) => typeof value === 'string' && value.trim(),
  ));
}

export function validateAiRecognitionPrompt(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请输入 AI 识别内容');
  if (value.trim().length > 4000) throw new Error('AI 识别内容不能超过 4000 字');
  return value.trim();
}
