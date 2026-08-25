import {
  createId,
  querySql,
  runSql,
  sqlNullableString,
  sqlString,
} from './storage/sqlite';

export type ModelUsageRecord = {
  id: string;
  modelKey: 'midscene' | 'scriptOptimizer';
  provider: string;
  modelName: string;
  family: string;
  success: boolean;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  errorMessage?: string;
  createdAt: string;
};

type ModelUsageRow = {
  id: string;
  model_key: 'midscene' | 'scriptOptimizer';
  provider: string;
  model_name: string;
  family: string | null;
  success: 0 | 1;
  duration_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  created_at: string;
};

let initialized = false;

function sqlNullableNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.max(0, Math.floor(value))) : 'NULL';
}

function rowToRecord(row: ModelUsageRow): ModelUsageRecord {
  return {
    id: row.id,
    modelKey: row.model_key,
    provider: row.provider,
    modelName: row.model_name,
    family: row.family || '',
    success: row.success === 1,
    durationMs: row.duration_ms,
    promptTokens: row.prompt_tokens ?? undefined,
    completionTokens: row.completion_tokens ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
  };
}

export function initModelUsageRepository() {
  if (initialized) return;
  initialized = true;
  runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS model_usage_records (
      id TEXT PRIMARY KEY,
      model_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      family TEXT NULL,
      success INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      prompt_tokens INTEGER NULL,
      completion_tokens INTEGER NULL,
      total_tokens INTEGER NULL,
      error_message TEXT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_model_usage_records_created_at ON model_usage_records(created_at DESC);
  `);
}

export function saveModelUsageRecord(input: Omit<ModelUsageRecord, 'id' | 'createdAt'> & { createdAt?: string }) {
  initModelUsageRepository();
  const id = createId('usage');
  const createdAt = input.createdAt || new Date().toISOString();
  runSql(`
    INSERT INTO model_usage_records (
      id,
      model_key,
      provider,
      model_name,
      family,
      success,
      duration_ms,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      error_message,
      created_at
    )
    VALUES (
      ${sqlString(id)},
      ${sqlString(input.modelKey)},
      ${sqlString(input.provider || 'custom')},
      ${sqlString(input.modelName || '')},
      ${sqlNullableString(input.family)},
      ${input.success ? 1 : 0},
      ${sqlNullableNumber(input.durationMs)},
      ${sqlNullableNumber(input.promptTokens)},
      ${sqlNullableNumber(input.completionTokens)},
      ${sqlNullableNumber(input.totalTokens)},
      ${sqlNullableString(input.errorMessage)},
      ${sqlString(createdAt)}
    );
  `);
  return listModelUsageRecords(1)[0];
}

export function listModelUsageRecords(limit = 50) {
  initModelUsageRepository();
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return querySql<ModelUsageRow>(`
    SELECT *
    FROM model_usage_records
    ORDER BY datetime(created_at) DESC
    LIMIT ${boundedLimit};
  `).map(rowToRecord).reverse();
}
