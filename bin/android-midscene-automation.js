#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteRoot = path.dirname(require.resolve('vite/package.json'));
const viteBin = path.join(viteRoot, 'bin', 'vite.js');
const args = process.argv.slice(2);
const userRoot = process.cwd();

if (!args.includes('--host')) {
  args.unshift('127.0.0.1');
  args.unshift('--host');
}

const child = spawn(process.execPath, [viteBin, ...args], {
  cwd: packageRoot,
  env: {
    ...process.env,
    ANDROID_MIDSCENE_PACKAGE_ROOT: process.env.ANDROID_MIDSCENE_PACKAGE_ROOT || packageRoot,
    ANDROID_MIDSCENE_DATA_ROOT: process.env.ANDROID_MIDSCENE_DATA_ROOT || userRoot,
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
