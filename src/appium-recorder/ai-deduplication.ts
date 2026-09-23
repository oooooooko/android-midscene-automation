export type AiDeduplicationConfig = {
  method: 'none' | 'pixelmatch' | 'opencv';
  pixelmatch: { threshold: number; maxChangedRatio: number };
  opencv: { similarityThreshold: number; maxDimension: number };
};

export function resolveAiDeduplication(value?: unknown): AiDeduplicationConfig {
  const object = (value: unknown): Record<string, unknown> => {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('截图去重配置必须为对象');
    return value as Record<string, unknown>;
  };
  const input = object(value), pixel = object(input.pixelmatch), cv = object(input.opencv);
  const method = input.method ?? 'pixelmatch';
  if (method !== 'none' && method !== 'pixelmatch' && method !== 'opencv') throw new Error('截图去重方式必须为 none、pixelmatch 或 opencv');
  const number = (value: unknown, fallback: number, min: number, max: number, label: string, integer = false) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(`${label}需为 ${min}～${max} ${integer ? '的整数' : '的数值'}`);
    }
    return value;
  };
  return {
    method,
    pixelmatch: {
      threshold: number(pixel.threshold, 0.1, 0, 1, '像素颜色容差'),
      maxChangedRatio: number(pixel.maxChangedRatio, 0.5, 0, 100, '允许变化面积（%）'),
    },
    opencv: {
      similarityThreshold: number(cv.similarityThreshold, 0.99, 0.5, 1, 'SSIM 相似度阈值'),
      maxDimension: number(cv.maxDimension, 512, 128, 1024, '比较图像最长边', true),
    },
  };
}
