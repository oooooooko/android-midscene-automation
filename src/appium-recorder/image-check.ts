import type { AppiumVisualChangeRegion } from './types';
import { DEFAULT_NODE_TIMEOUT_MS } from './node-timeout';

export const IMAGE_CHECK_MODES = { template: '模板匹配', state: '图片状态判断', black: '黑屏检测', color: '区域颜色判断', change: '多帧变化检测' } as const;
export type ImageCheckConfig = {
  mode: keyof typeof IMAGE_CHECK_MODES;
  target: 'region' | 'element';
  region: AppiumVisualChangeRegion;
  screenWidth: number;
  screenHeight: number;
  template?: string;
  negativeTemplate?: string;
  expectation: 'present' | 'absent';
  threshold: number;
  minScoreGap: number;
  color: string;
  tolerance: number;
  ratio: number;
  durationMs: number;
  intervalMs: number;
  consecutive: number;
};
export type ImageCheckResult = {
  templateMatch?: { matched: boolean; expected: 'present' | 'absent'; score: number; threshold: number };
  timedOut?: boolean;
  result: boolean | null;
  mode: ImageCheckConfig['mode'];
  region: AppiumVisualChangeRegion;
  message: string;
  durationMs: number;
  sampleCount: number;
  metrics: Record<string, number>;
  images: { label: string; base64: string }[];
};

export function createImageCheckConfig(): ImageCheckConfig {
  return { mode: 'template', target: 'region', region: { x: 0, y: 0, width: 100, height: 100 },
    screenWidth: 0, screenHeight: 0, expectation: 'present', threshold: 0.9, minScoreGap: 0.1,
    color: '#000000', tolerance: 30, ratio: 95, durationMs: DEFAULT_NODE_TIMEOUT_MS, intervalMs: 1000, consecutive: 1 };
}

// 只读取 PNG 头部尺寸，避免为了表单校验解码整张模板。
export function imageTemplateSize(base64?: string) {
  if (!base64) return undefined;
  try {
    const header = atob(base64.slice(0, 32));
    if (header.length < 24 || header.slice(0, 8) !== '\x89PNG\r\n\x1a\n') return undefined;
    const uint = (offset: number) => (header.charCodeAt(offset) * 0x1000000
      + header.charCodeAt(offset + 1) * 0x10000 + header.charCodeAt(offset + 2) * 0x100 + header.charCodeAt(offset + 3));
    const width = uint(16), height = uint(20);
    return width && height ? { width, height } : undefined;
  } catch { return undefined; }
}

export function imageTemplateRegionIssue(config: ImageCheckConfig) {
  if (!['template', 'state'].includes(config.mode)) return '';
  const templates = [{ value: config.template, label: config.mode === 'state' ? '选中模板' : '模板' },
    ...(config.mode === 'state' ? [{ value: config.negativeTemplate, label: '未选中模板' }] : [])];
  for (const template of templates) {
    const size = imageTemplateSize(template.value);
    if (size && (size.width > config.region.width || size.height > config.region.height)) {
      return `${template.label} ${size.width}×${size.height} 超过检测区域 ${config.region.width}×${config.region.height}，${config.target === 'region' ? '请扩大区域或重新采集模板' : '请重新选择组件或采集对应模板'}`;
    }
  }
  return '';
}

export function expandedImageTemplateRegion(config: ImageCheckConfig) {
  if (config.target !== 'region' || !['template', 'state'].includes(config.mode)) return undefined;
  const sizes = [config.template, ...(config.mode === 'state' ? [config.negativeTemplate] : [])].map(imageTemplateSize);
  const width = Math.max(config.region.width, ...sizes.map(size => size?.width || 0));
  const height = Math.max(config.region.height, ...sizes.map(size => size?.height || 0));
  if (width > config.screenWidth || height > config.screenHeight || !Number.isFinite(width + height)) return undefined;
  // 用户明确选择扩区时以原区域中心扩展，并保证仍在屏幕内，不改变模板像素。
  const x = Math.max(0, Math.min(config.screenWidth - width, Math.floor(config.region.x + (config.region.width - width) / 2)));
  const y = Math.max(0, Math.min(config.screenHeight - height, Math.floor(config.region.y + (config.region.height - height) / 2)));
  return { x, y, width, height };
}

export function validateImageCheck(config: ImageCheckConfig | undefined) {
  if (!config || !Object.prototype.hasOwnProperty.call(IMAGE_CHECK_MODES, config.mode)) throw new Error('请选择图像判断模式');
  const range = (value: number, min: number, max: number, name: string, integer = false) => {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${name}必须在 ${min} 至 ${max} 之间${integer ? '，且为整数' : ''}`);
  };
  if (!['region', 'element'].includes(config.target)) throw new Error('检测目标无效');
  if (!['present', 'absent'].includes(config.expectation)) throw new Error('判断条件无效');
  range(config.region?.x, 0, 16000, '区域 X', true);
  range(config.region?.y, 0, 16000, '区域 Y', true);
  range(config.region?.width, 1, 16000, '区域宽度', true);
  range(config.region?.height, 1, 16000, '区域高度', true);
  if (config.target === 'region') {
    range(config.screenWidth, 1, 16000, '采集屏幕宽度', true);
    range(config.screenHeight, 1, 16000, '采集屏幕高度', true);
  }
  range(config.threshold, 0.01, 1, '模板阈值');
  range(config.minScoreGap, 0.001, 1, '最小得分差');
  range(config.tolerance, 0, 255, '像素容差', true);
  range(config.ratio, 0.01, 100, '像素占比');
  range(config.durationMs, 0, 60000, '观察时长', true);
  range(config.intervalMs, 200, 10000, '采样间隔', true);
  range(config.consecutive, 1, 100, '连续满足帧数', true);
  if (config.consecutive > Math.floor(config.durationMs / config.intervalMs) + 1) throw new Error('观察时间不足以采集连续满足帧数');
  if (config.mode === 'change' && config.durationMs < config.intervalMs) throw new Error('多帧变化的观察时长不能小于采样间隔');
  if (!/^#[0-9a-f]{6}$/i.test(config.color)) throw new Error('目标颜色必须为 #RRGGBB 格式');
  for (const value of [config.template, config.negativeTemplate]) {
    if (value && (value.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))) throw new Error('模板必须是小于 3MB 的 PNG 图片');
  }
  if (['template', 'state'].includes(config.mode) && !config.template) throw new Error('请采集或上传模板');
  if (config.mode === 'state' && !config.negativeTemplate) throw new Error('请采集或上传未选中模板');
  if (config.target === 'region') {
    const issue = imageTemplateRegionIssue(config);
    if (issue) throw new Error(issue);
  }
  return config;
}

export function imageCheckSummary(config?: ImageCheckConfig) {
  if (!config) return '未配置图像判断';
  const expectation = config.mode === 'template' ? ` · ${config.expectation === 'present' ? '匹配到模板' : '未匹配到模板'}` : '';
  return `${IMAGE_CHECK_MODES[config.mode]}${expectation} · ${config.target === 'element' ? '组件区域' : '框选区域'} · ${config.durationMs}ms`;
}
