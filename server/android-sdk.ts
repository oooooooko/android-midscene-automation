import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config';
import { appDataPath } from './paths';

export type AndroidSdkInfo = {
  root: string;
  adbPath: string;
  source: 'config' | 'environment' | 'default' | 'path';
};

const adbFileName = process.platform === 'win32' ? 'adb.exe' : 'adb';

function expandPath(value: string) {
  const trimmed = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : appDataPath(trimmed);
}

function sdkInfoFromPath(value: string, source: AndroidSdkInfo['source']): AndroidSdkInfo | null {
  const candidate = expandPath(value);
  const lowerBaseName = path.basename(candidate).toLowerCase();
  const root = lowerBaseName === adbFileName.toLowerCase()
    ? path.dirname(path.dirname(candidate))
    : lowerBaseName === 'platform-tools'
      ? path.dirname(candidate)
      : candidate;
  const adbPath = path.join(root, 'platform-tools', adbFileName);
  if (!fs.existsSync(adbPath)) return null;
  return { root, adbPath, source };
}

function findAdbOnPath() {
  const directories = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    const adbPath = path.join(directory.replace(/^(["'])(.*)\1$/, '$2'), adbFileName);
    if (fs.existsSync(adbPath)) return fs.realpathSync(adbPath);
  }
  return '';
}

function defaultSdkPaths() {
  if (process.platform === 'darwin') return [path.join(os.homedir(), 'Library', 'Android', 'sdk')];
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')] : [];
  }
  return [path.join(os.homedir(), 'Android', 'Sdk')];
}

export function resolveAndroidSdk(): AndroidSdkInfo {
  const configuredPath = loadConfig().runtime.androidSdkPath.trim();
  if (configuredPath) {
    const configured = sdkInfoFromPath(configuredPath, 'config');
    if (configured) return configured;
    throw new Error(`参数配置中的 Android SDK 路径无效：${configuredPath}。请选择包含 platform-tools/${adbFileName} 的 SDK 目录。`);
  }

  const candidates = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME]
    .filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const resolved = sdkInfoFromPath(candidate, 'environment');
    if (resolved) return resolved;
  }

  for (const candidate of defaultSdkPaths()) {
    const resolved = sdkInfoFromPath(candidate, 'default');
    if (resolved) return resolved;
  }

  const adbPath = findAdbOnPath();
  if (adbPath) {
    return {
      root: path.dirname(path.dirname(adbPath)),
      adbPath,
      source: 'path',
    };
  }

  throw new Error('未检测到 Android SDK。请在“参数配置 > 运行配置”中指定 Android SDK 路径，或配置 ANDROID_SDK_ROOT/ANDROID_HOME。');
}

export function ensureAndroidSdkAvailable() {
  const sdk = resolveAndroidSdk();
  process.env.ANDROID_HOME = sdk.root;
  process.env.ANDROID_SDK_ROOT = sdk.root;
  const platformTools = path.dirname(sdk.adbPath);
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  if (!pathEntries.includes(platformTools)) {
    process.env.PATH = [platformTools, ...pathEntries].filter(Boolean).join(path.delimiter);
  }
  return sdk;
}

export function getAdbCommand() {
  try {
    return ensureAndroidSdkAvailable().adbPath;
  } catch {
    return process.platform === 'win32' ? 'adb.exe' : 'adb';
  }
}
