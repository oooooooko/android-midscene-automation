export type MidsceneModelProvider = 'custom' | 'codex';
export type MidsceneModelPresetKey = 'gpt' | 'doubao';

export type MidsceneModelPreset = {
  key: MidsceneModelPresetKey;
  label: string;
  baseUrl: string;
  modelName: string;
  modelFamily: string;
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
  { label: 'Doubao Seed 2.1 Pro 260628', value: 'doubao-seed-2-1-pro-260628', family: 'doubao-seed' },
  { label: 'Doubao Seed 2.1 Turbo', value: 'doubao-seed-2.1-turbo', family: 'doubao-seed' },
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
  { label: 'MiMo V2.5', value: 'mimo-v2.5', family: 'xiaomi-mimo' },
  { label: 'GLM 5V Turbo', value: 'glm-5v-turbo', family: 'glm-v' },
  { label: 'GLM 4.6V', value: 'glm-4.6v', family: 'glm-v' },
];

export const midsceneModelFamilyOptions = Array.from(
  new Set(midsceneModelOptions.map((option) => option.family)),
).map((family) => ({ label: family, value: family }));

export const midsceneModelPresets: MidsceneModelPreset[] = [
  {
    key: 'gpt',
    label: 'GPT',
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-5.5',
    modelFamily: 'gpt-5',
  },
  {
    key: 'doubao',
    label: 'Doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelName: 'doubao-seed-2-1-pro-260628',
    modelFamily: 'doubao-seed',
  },
];
