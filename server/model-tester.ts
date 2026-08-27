import { execFile } from 'node:child_process';
import OpenAI from 'openai';

type ModelInput = {
  provider?: 'custom' | 'codex';
  baseUrl: string;
  apiKey: string;
  name: string;
  family?: string;
};

const CODEX_MODEL_NAMES = new Set([
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
]);

type ModelUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type ModelTestResult = {
  ok: boolean;
  content: string;
  durationMs: number;
  usage?: ModelUsage;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function normalizeModelName(value: string) {
  return value.trim().replace(/[‐‑‒–—―]/g, '-');
}

function visibleContent(value: string) {
  return value.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || value.trim();
}

function execCodex(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile('codex', args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve((stdout || stderr).trim());
    });
  });
}

async function testCodexConnection(input: ModelInput): Promise<ModelTestResult> {
  const startedAt = Date.now();
  if (input.baseUrl !== 'codex://app-server' || !input.name || input.family !== 'gpt-5') {
    throw new Error('Codex 配置不完整，请使用 codex://app-server、gpt-5 family 和支持的 GPT-5 模型');
  }

  if (!CODEX_MODEL_NAMES.has(input.name)) {
    throw new Error(`Codex 模型不在当前支持列表：${Array.from(CODEX_MODEL_NAMES).join('、')}`);
  }

  const loginStatus = await execCodex(['login', 'status']);
  await execCodex(['app-server', '--help']);

  return {
    ok: true,
    content: `Codex 可用：${loginStatus || '已登录'}；app-server 可用；模型 ${input.name}/${input.family}`,
    durationMs: Date.now() - startedAt,
  };
}

export async function testModelConnection(input: ModelInput): Promise<ModelTestResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const modelName = normalizeModelName(input.name);

  if (input.provider === 'codex' || baseUrl === 'codex://app-server') {
    return testCodexConnection(input);
  }

  if (!baseUrl || !input.apiKey.trim() || !modelName) {
    throw new Error('模型配置不完整');
  }

  const startedAt = Date.now();
  const client = new OpenAI({
    apiKey: input.apiKey.trim(),
    baseURL: baseUrl,
  });

  const result = await client.chat.completions.create({
    model: modelName,
    temperature: 0,
    max_completion_tokens: 128,
    messages: [
      {
        role: 'user',
        content: 'Reply with OK only.',
      },
    ],
  });

  const content = visibleContent(result.choices[0]?.message?.content || '');
  const usage: ModelUsage = {
    promptTokens: result.usage?.prompt_tokens,
    completionTokens: result.usage?.completion_tokens,
    totalTokens: result.usage?.total_tokens,
  };

  return {
    ok: true,
    content,
    durationMs: Date.now() - startedAt,
    usage,
  };
}
