import type { AiDeduplicationConfig } from './ai-deduplication';

export type AiRecognitionModel = { baseUrl: string; apiKey: string; name: string };
export type AiInvalidResultBranch = 'yes' | 'no';
export type AiObservationConfig = { durationMs: number; intervalMs: number; mode?: 'batch' | 'untilMatch' };
export type AiObservationFrame = { elapsedMs: number; imageDataUrl: string };
export type AiRecognitionResult = {
  result: boolean | null; reason: string; durationMs: number;
  observation?: { durationMs: number; frames: AiObservationFrame[]; sampleCount?: number; deduplicationMethod?: AiDeduplicationConfig['method']; completion?: 'matched' | 'elapsed'; modelRequestCount?: number };
};
export const DEFAULT_AI_OBSERVATION: AiObservationConfig = { durationMs: 15000, intervalMs: 1000 };
export const MAX_AI_OBSERVATION_FRAMES = 30;

export function validateAiObservation(value: unknown): AiObservationConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('持续观察配置无效');
  const { durationMs, intervalMs, mode } = value as AiObservationConfig;
  if (mode !== undefined && mode !== 'batch' && mode !== 'untilMatch') throw new Error('持续观察模式无效');
  if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 60000) throw new Error('观察时长需为 1000～60000 ms');
  if (!Number.isInteger(intervalMs) || intervalMs < 500 || intervalMs > 10000) throw new Error('采样间隔需为 500～10000 ms');
  if (Math.ceil(durationMs / intervalMs) + 1 > MAX_AI_OBSERVATION_FRAMES) throw new Error('单次观察最多采集 30 帧，请增大采样间隔或缩短观察时长');
  return { durationMs, intervalMs, ...(mode ? { mode } : {}) };
}

export function validateAiInvalidResultBranch(value: unknown): AiInvalidResultBranch | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value !== 'yes' && value !== 'no') throw new Error('AI 无有效结果兜底分支无效');
  return value;
}

// 未保存此字段的是旧版判断节点，保留已有分支；新节点显式保存 false。
export function isAiBranchEnabled(step: { aiBranchEnabled?: boolean }) {
  return step.aiBranchEnabled !== false;
}

export const AI_MODEL_CONFIG_HINT = '请在参数配置 > Appium配置中填写 AI 识别模型的 Base URL、API Key 和 Model Name，配置会自动保存';

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
