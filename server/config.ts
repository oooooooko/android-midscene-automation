import fs from 'node:fs';
import os from 'node:os';
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
const adbFileName = process.platform === 'win32' ? 'adb.exe' : 'adb';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

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

function expandRuntimePath(value: string) {
  const trimmed = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : appDataPath(trimmed);
}

function isAbsoluteRuntimePath(value: string) {
  const trimmed = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  return trimmed === '~'
    || trimmed.startsWith(`~${path.sep}`)
    || trimmed.startsWith('~/')
    || path.isAbsolute(trimmed);
}

function validateAndroidSdkPath(value: string) {
  if (!value) return;
  const candidate = expandRuntimePath(value);
  const lowerBaseName = path.basename(candidate).toLowerCase();
  const root = lowerBaseName === adbFileName.toLowerCase()
    ? path.dirname(path.dirname(candidate))
    : lowerBaseName === 'platform-tools'
      ? path.dirname(candidate)
      : candidate;
  const adbPath = path.join(root, 'platform-tools', adbFileName);
  if (!fs.existsSync(adbPath)) {
    throw new ConfigValidationError(
      `Android SDK 路径无效：${value}。请选择包含 platform-tools/${adbFileName} 的 SDK 目录。`,
    );
  }
}

function validateReportOutputPath(value: string) {
  if (!value) return;
  if (!isAbsoluteRuntimePath(value)) {
    throw new ConfigValidationError(`回放报告目录无效：${value}。请填写绝对路径，或留空使用默认 output 目录。`);
  }
  const outputDir = expandRuntimePath(value);
  try {
    if (!fs.existsSync(outputDir)) {
      throw new Error('目录不存在');
    }
    if (!fs.statSync(outputDir).isDirectory()) {
      throw new Error('不是目录');
    }
    fs.accessSync(outputDir, fs.constants.W_OK);
  } catch (error) {
    const detail = error instanceof Error && error.message ? `（${error.message}）` : '';
    throw new ConfigValidationError(`回放报告目录无效：${value}。请选择已经存在并可写入的目录${detail}。`);
  }
}

function validateRuntimeConfig(config: AppConfig) {
  validateAndroidSdkPath(config.runtime.androidSdkPath);
  validateReportOutputPath(config.runtime.reportOutputPath);
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
  const normalized = normalizeConfig(config);
  validateRuntimeConfig(normalized);
  cachedConfig = normalized;
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
