import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { appDataPath } from './paths';
import { loadModelConfigFromDb, saveModelConfigToDb } from './config-store';

export type AppConfig = {
  runtime: {
    androidSdkPath: string;
    reportOutputPath: string;
  };
  midscene: {
    model: {
      provider: 'custom' | 'codex';
      baseUrl: string;
      apiKey: string;
      name: string;
      family: string;
    };
    env: Record<string, string>;
  };
  scriptOptimizer: {
    model: {
      baseUrl: string;
      apiKey: string;
      name: string;
    };
  };
};

let cachedConfig: AppConfig | null = null;
const configPath = appDataPath('config.json');
const legacyConfigPath = appDataPath('config.yaml');

function defaultConfig(): AppConfig {
  return {
    runtime: {
      androidSdkPath: '',
      reportOutputPath: '',
    },
    midscene: {
      model: {
        provider: 'custom',
        baseUrl: '',
        apiKey: '',
        name: '',
        family: '',
      },
      env: {},
    },
    scriptOptimizer: {
      model: {
        baseUrl: '',
        apiKey: '',
        name: '',
      },
    },
  };
}

function normalizeEnv(env: unknown): Record<string, string> {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''),
  );
}

function normalizeConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
  const fallback = defaultConfig();
  return {
    runtime: {
      androidSdkPath: config?.runtime?.androidSdkPath?.trim() || fallback.runtime.androidSdkPath,
      reportOutputPath: config?.runtime?.reportOutputPath?.trim() || fallback.runtime.reportOutputPath,
    },
    midscene: {
      model: {
        provider: config?.midscene?.model?.provider || (
          config?.midscene?.model?.baseUrl === 'codex://app-server' ? 'codex' : fallback.midscene.model.provider
        ),
        baseUrl: config?.midscene?.model?.baseUrl || fallback.midscene.model.baseUrl,
        apiKey: config?.midscene?.model?.apiKey || fallback.midscene.model.apiKey,
        name: config?.midscene?.model?.name || fallback.midscene.model.name,
        family: config?.midscene?.model?.family || fallback.midscene.model.family,
      },
      env: normalizeEnv(config?.midscene?.env),
    },
    scriptOptimizer: {
      model: {
        baseUrl: config?.scriptOptimizer?.model?.baseUrl || fallback.scriptOptimizer.model.baseUrl,
        apiKey: config?.scriptOptimizer?.model?.apiKey || fallback.scriptOptimizer.model.apiKey,
        name: config?.scriptOptimizer?.model?.name || fallback.scriptOptimizer.model.name,
      },
    },
  };
}

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const dbConfig = loadModelConfigFromDb();
  if (dbConfig) {
    cachedConfig = normalizeConfig(dbConfig);
    return cachedConfig;
  }

  if (fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AppConfig>;
    cachedConfig = normalizeConfig(parsed);
    saveModelConfigToDb(cachedConfig);
    return cachedConfig;
  }

  if (fs.existsSync(legacyConfigPath)) {
    const parsed = YAML.parse(fs.readFileSync(legacyConfigPath, 'utf8')) as Partial<AppConfig>;
    cachedConfig = normalizeConfig(parsed);
    saveConfig(cachedConfig);
    return cachedConfig;
  }

  cachedConfig = defaultConfig();
  saveConfig(cachedConfig);
  return cachedConfig;
}

export function saveConfig(config: AppConfig) {
  cachedConfig = normalizeConfig(config);
  saveModelConfigToDb(cachedConfig);
}

export function applyMidsceneEnv() {
  const config = loadConfig();
  for (const [key, value] of Object.entries(config.midscene.env)) {
    process.env[key] = value;
  }
  process.env.MIDSCENE_MODEL_BASE_URL = config.midscene.model.baseUrl;
  process.env.MIDSCENE_MODEL_API_KEY = config.midscene.model.apiKey;
  process.env.MIDSCENE_MODEL_NAME = config.midscene.model.name;
  process.env.MIDSCENE_MODEL_FAMILY = config.midscene.model.family;
}
