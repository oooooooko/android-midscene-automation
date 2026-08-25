import fs from 'node:fs';
import path from 'node:path';
import { appDataPath } from './paths';
import { saveModelUsageRecord } from './model-usage-repository';

type MidsceneModelConfig = {
  provider?: string;
  name?: string;
  family?: string;
};

type ModelCallUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  time_cost?: number;
  model_name?: string;
  response_model_name?: string;
  model_description?: string;
};

type ModelCallRecord = {
  timestamp?: string;
  type?: string;
  modelFamily?: string;
  provider?: string;
  final?: {
    usage?: ModelCallUsage;
    timeCost?: number;
  };
};

function modelRequestDir() {
  return appDataPath('midscene_run', 'model-requests');
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function listModelRequestFilesSince(sinceMs: number) {
  const dir = modelRequestDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
    .filter((filePath) => {
      const stat = fs.statSync(filePath);
      return stat.mtimeMs >= sinceMs - 1_000;
    });
}

function recordsFromFile(filePath: string) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ModelCallRecord];
      } catch {
        return [];
      }
    });
}

export function importMidsceneModelUsage(input: {
  sinceMs: number;
  model: MidsceneModelConfig;
  success: boolean;
}) {
  let imported = 0;
  const files = listModelRequestFilesSince(input.sinceMs);

  for (const filePath of files) {
    for (const record of recordsFromFile(filePath)) {
      if (record.type !== 'response') continue;
      const usage = record.final?.usage;
      if (!usage) continue;

      const promptTokens = numberValue(usage.prompt_tokens);
      const completionTokens = numberValue(usage.completion_tokens);
      const totalTokens = numberValue(usage.total_tokens) ?? numberValue((promptTokens || 0) + (completionTokens || 0));

      saveModelUsageRecord({
        modelKey: 'midscene',
        provider: input.model.provider || (record.provider === 'codex-app-server' ? 'codex' : 'custom'),
        modelName: usage.model_name || usage.response_model_name || input.model.name || '',
        family: input.model.family || record.modelFamily || '',
        success: input.success,
        durationMs: numberValue(usage.time_cost) ?? numberValue(record.final?.timeCost) ?? 0,
        promptTokens,
        completionTokens,
        totalTokens,
        createdAt: record.timestamp,
      });
      imported += 1;
    }
  }

  return {
    imported,
    files,
  };
}
