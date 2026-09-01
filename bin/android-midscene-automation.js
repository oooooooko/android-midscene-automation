#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteRoot = path.dirname(require.resolve('vite/package.json'));
const viteBin = path.join(viteRoot, 'bin', 'vite.js');
const args = process.argv.slice(2);
const userRoot = process.cwd();
const githubUrl = 'https://github.com/oooooooko/android-midscene-automation';
const appName = 'android-midscene-automation';
const runtimeEntries = [
  '.midscene-app',
  'scripts-output',
  'midscene_run',
  '.midscene-generated',
  'config.json',
  'config.yaml',
  'output',
];
const runtimeMarkerEntries = ['.midscene-app', 'scripts-output', 'midscene_run', '.midscene-generated'];

function getDefaultDataRoot() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      appName,
    );
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }

  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), appName);
}

function hasRuntimeData(root) {
  return runtimeMarkerEntries.some((entry) => fs.existsSync(path.join(root, entry)));
}

function copyRuntimeEntry(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
    return;
  }

  if (!fs.existsSync(target)) {
    fs.copyFileSync(source, target);
  }
}

function migrateLegacyDataRoot(sourceRoot, targetRoot) {
  if (process.env.ANDROID_MIDSCENE_DATA_ROOT || path.resolve(sourceRoot) === path.resolve(targetRoot)) return;
  if (!hasRuntimeData(sourceRoot)) return;

  try {
    fs.mkdirSync(targetRoot, { recursive: true });
    let copied = false;
    for (const entry of runtimeEntries) {
      const source = path.join(sourceRoot, entry);
      if (!fs.existsSync(source)) continue;
      copyRuntimeEntry(source, path.join(targetRoot, entry));
      copied = true;
    }
    if (copied) {
      console.log(`已迁移本地数据目录：${sourceRoot} -> ${targetRoot}`);
    }
  } catch (error) {
    console.warn(`迁移本地数据目录失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

const dataRoot = process.env.ANDROID_MIDSCENE_DATA_ROOT || getDefaultDataRoot();

migrateLegacyDataRoot(userRoot, dataRoot);

if (!args.includes('--host')) {
  args.unshift('127.0.0.1');
  args.unshift('--host');
}

console.log(`\nGitHub 源码 / 二次修改：${githubUrl}`);
console.log(`问题反馈 / 功能建议：${githubUrl}/issues\n`);
console.log(`本地数据目录：${dataRoot}\n`);

const child = spawn(process.execPath, [viteBin, ...args], {
  cwd: packageRoot,
  env: {
    ...process.env,
    ANDROID_MIDSCENE_PACKAGE_ROOT: process.env.ANDROID_MIDSCENE_PACKAGE_ROOT || packageRoot,
    ANDROID_MIDSCENE_DATA_ROOT: dataRoot,
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
