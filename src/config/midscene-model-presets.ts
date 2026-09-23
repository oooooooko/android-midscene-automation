export type MidsceneModelPresetKey = 'gpt' | 'doubao' | 'qwen' | 'deepseek' | 'gemini' | 'kimi' | 'mimo' | 'glm' | 'glm-global' | 'autoglm' | 'autoglm-global' | 'ui-tars';
export type MidsceneModelProvider = 'custom' | 'codex' | MidsceneModelPresetKey;

export type MidsceneModelPreset = {
  key: MidsceneModelPresetKey;
  label: string;
  baseUrl: string;
  modelName: string;
  modelFamily: string;
  modelFamilies?: string[];
  hint?: string;
};

export type MidsceneModelOption = {
  label: string;
  value: string;
  family: string;
};

export const codexMidsceneModel = {
  provider: 'codex' as const,
  baseUrl: 'codex://app-server',
  apiKey: '',
  name: 'gpt-5.5',
  family: 'gpt-5',
};

export const codexMidsceneModelOptions: MidsceneModelOption[] = [
  { label: 'GPT-5.5（推荐）', value: 'gpt-5.5', family: 'gpt-5' },
  { label: 'GPT-5.6 Sol', value: 'gpt-5.6-sol', family: 'gpt-5' },
  { label: 'GPT-5.6 Terra', value: 'gpt-5.6-terra', family: 'gpt-5' },
  { label: 'GPT-5.6 Luna', value: 'gpt-5.6-luna', family: 'gpt-5' },
  { label: 'GPT-5.4', value: 'gpt-5.4', family: 'gpt-5' },
];

export const midsceneModelOptions: MidsceneModelOption[] = [
  ...codexMidsceneModelOptions,
  { label: 'GPT-6 Sol', value: 'gpt-6-sol', family: 'gpt-6' },
  { label: 'DeepSeek Flash', value: 'deepseek-flash', family: 'deepseek' },
  { label: 'AutoGLM Phone', value: 'autoglm-phone', family: 'auto-glm' },
  { label: 'Doubao Seed 2.1 Pro 260628', value: 'doubao-seed-2-1-pro-260628', family: 'doubao-seed' },
  { label: 'Doubao Seed 2.1 Turbo', value: 'doubao-seed-2-1-turbo-260628', family: 'doubao-seed' },
  { label: 'Doubao Seed 2.0 Lite', value: 'doubao-seed-2.0-lite', family: 'doubao-seed' },
  { label: 'Doubao Seed 1.6 Vision', value: 'doubao-seed-1.6-vision', family: 'doubao-seed' },
  { label: 'Doubao Seed 1.8', value: 'doubao-seed-1.8', family: 'doubao-seed' },
  { label: 'Qwen 3.7 Plus', value: 'qwen3.7-plus', family: 'qwen3' },
  { label: 'Qwen 3.5 Plus', value: 'qwen3.5-plus', family: 'qwen3' },
  { label: 'Qwen 3.6 Plus', value: 'qwen3.6-plus', family: 'qwen3' },
  { label: 'Qwen 3 VL Plus', value: 'qwen3-vl-plus', family: 'qwen3-vl' },
  { label: 'Qwen VL Max Latest', value: 'qwen-vl-max-latest', family: 'qwen2.5-vl' },
  { label: 'Gemini 3.5 Flash', value: 'gemini-3.5-flash', family: 'gemini' },
  { label: 'Gemini 3 Flash Preview', value: 'gemini-3-flash-preview', family: 'gemini' },
  { label: 'Kimi K3', value: 'kimi-k3', family: 'kimi3' },
  { label: 'Kimi K2.5', value: 'kimi-k2.5', family: 'kimi' },
  { label: 'Kimi K2.6', value: 'kimi-k2.6', family: 'kimi' },
  { label: 'MiMo V2.6 Pro', value: 'mimo-v2.6-pro', family: 'xiaomi-mimo' },
  { label: 'MiMo V2.5', value: 'mimo-v2.5', family: 'xiaomi-mimo' },
  { label: 'GLM 5V Turbo', value: 'glm-5v-turbo', family: 'glm-v' },
  { label: 'GLM 4.6V', value: 'glm-4.6v', family: 'glm-v' },
];

export const midsceneModelFamilyOptions = Array.from(
  new Set([...midsceneModelOptions.map((option) => option.family), 'auto-glm-multilingual', 'vlm-ui-tars', 'vlm-ui-tars-doubao', 'vlm-ui-tars-doubao-1.5']),
).map((family) => ({ label: family, value: family }));

// 官方配置示例：https://midscenejs.com/zh/model-common-config.html（2026-09-23）。
export const midsceneModelPresets: MidsceneModelPreset[] = [
  {
    key: 'gpt',
    label: 'OpenAI GPT',
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-6-sol',
    modelFamily: 'gpt-6',
    modelFamilies: ['gpt-5', 'gpt-6'],
  },
  {
    key: 'doubao',
    label: '火山引擎 · 豆包 Seed',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelName: 'doubao-seed-2-1-turbo-260628',
    modelFamily: 'doubao-seed',
  },
  { key: 'qwen', label: '阿里云 · 千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen3.7-plus', modelFamily: 'qwen3', modelFamilies: ['qwen3', 'qwen3-vl', 'qwen2.5-vl'] },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-flash', modelFamily: 'deepseek' },
  { key: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', modelName: 'gemini-3.5-flash', modelFamily: 'gemini' },
  { key: 'kimi', label: '月之暗面 · Kimi', baseUrl: 'https://api.moonshot.cn/v1', modelName: 'kimi-k3', modelFamily: 'kimi3', modelFamilies: ['kimi3', 'kimi'] },
  { key: 'mimo', label: '小米 · MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', modelName: 'mimo-v2.6-pro', modelFamily: 'xiaomi-mimo' },
  { key: 'glm', label: '智谱 BigModel · GLM-V（国内）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelName: 'glm-5v-turbo', modelFamily: 'glm-v' },
  { key: 'glm-global', label: '智谱 Z.AI · GLM-V（国际）', baseUrl: 'https://api.z.ai/api/paas/v4', modelName: 'glm-5v-turbo', modelFamily: 'glm-v' },
  { key: 'autoglm', label: '智谱 BigModel · AutoGLM（国内）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelName: 'autoglm-phone', modelFamily: 'auto-glm', modelFamilies: ['auto-glm', 'auto-glm-multilingual'], hint: '模型名称以平台实际名称为准；aiAssert / aiQuery 等页面理解任务需另外配置 Insight 模型。' },
  { key: 'autoglm-global', label: '智谱 Z.AI · AutoGLM（国际）', baseUrl: 'https://api.z.ai/api/paas/v4', modelName: 'autoglm-phone', modelFamily: 'auto-glm', modelFamilies: ['auto-glm', 'auto-glm-multilingual'], hint: '模型名称以平台实际名称为准；aiAssert / aiQuery 等页面理解任务需另外配置 Insight 模型。' },
  { key: 'ui-tars', label: '火山引擎 · UI-TARS', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', modelName: '', modelFamily: 'vlm-ui-tars-doubao-1.5', modelFamilies: ['vlm-ui-tars', 'vlm-ui-tars-doubao', 'vlm-ui-tars-doubao-1.5'], hint: '请在 Model Name 中填写已部署 UI-TARS 的推理接入点 ID（ep-…）或实际模型名称。' },
];

type MidsceneModelConfig = { provider: MidsceneModelProvider; baseUrl: string; apiKey: string; name: string; family: string };

export function selectMidsceneModelProvider(provider: MidsceneModelProvider, current: MidsceneModelConfig, custom: Omit<MidsceneModelConfig, 'provider'>): MidsceneModelConfig {
  if (provider === 'codex') return { ...codexMidsceneModel };
  if (provider === 'custom') return { ...custom, provider };
  const preset = midsceneModelPresets.find(item => item.key === provider);
  if (!preset) return current;
  return { ...current, provider, baseUrl: preset.baseUrl, name: preset.modelName, family: preset.modelFamily };
}
