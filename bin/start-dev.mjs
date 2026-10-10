import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const binDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(binDir, '..');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const vitePort = args.find(arg => arg.startsWith('--port='))?.slice(7)
  || (portIndex >= 0 ? args[portIndex + 1] : '5173');
const artemisPort = process.env.ARTEMIS_PORT || '8000';
const localArtemisUrl = `http://127.0.0.1:${artemisPort}`;
const env = {
  ...process.env,
  ARTEMIS_URL: process.env.ARTEMIS_URL || localArtemisUrl,
  ARTEMIS_EMBED_ORIGINS: process.env.ARTEMIS_EMBED_ORIGINS
    || `http://127.0.0.1:${vitePort},http://localhost:${vitePort},http://127.0.0.1:4173,http://localhost:4173`,
};
const children = new Set();
let stopping = false;
let killTimer;

function signalChild(child, signal) {
  try {
    if (!child.devProcessGroup) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`停止开发服务失败：${error.message}`);
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) signalChild(child, 'SIGTERM');
  // uv and Python belong to the launcher group, so descendants are cleaned too.
  killTimer = setTimeout(() => {
    for (const child of children) signalChild(child, 'SIGKILL');
  }, 5000);
  killTimer.unref();
}

function start(script, scriptArgs, required) {
  const devProcessGroup = !required && process.platform !== 'win32';
  const child = spawn(process.execPath, [script, ...scriptArgs], {
    cwd: projectRoot, env, stdio: 'inherit', detached: devProcessGroup,
  });
  child.devProcessGroup = devProcessGroup;
  children.add(child);
  child.once('error', error => {
    console.error(`${required ? '主项目' : 'Artemis'} 启动失败：${error.message}`);
    children.delete(child);
    if (required) stop(1);
  });
  child.once('exit', code => {
    // Clean any descendants even if their direct parent has already exited.
    signalChild(child, 'SIGTERM');
    children.delete(child);
    if (!children.size) clearTimeout(killTimer);
    if (stopping) return;
    if (required) stop(code ?? 1);
    else console.warn('Artemis 服务已退出，主项目继续运行；排查上方日志后可执行 npm run artemis 重试。');
  });
}

// npm may forward a signal already delivered by the terminal; keep both handlers.
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('exit', () => {
  for (const child of children) signalChild(child, 'SIGTERM');
});

async function startArtemis() {
  if (env.ARTEMIS_AUTO_START === '0') return;
  try {
    const response = await fetch(new URL('/api/status', env.ARTEMIS_URL), {
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    const data = await response.json();
    if (response.ok && data.model_info) {
      console.log(`复用已运行的 Artemis：${env.ARTEMIS_URL}`);
      return;
    }
  } catch { /* No running Artemis; try the local launcher below. */ }
  if (stopping) return;
  const target = new URL(env.ARTEMIS_URL);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)
      || target.protocol !== 'http:' || (target.port || '80') !== artemisPort) {
    console.warn('ARTEMIS_URL 指向外部或不同端口的服务，请单独启动该服务；主项目继续运行。');
    return;
  }
  const projectDir = resolve(env.ARTEMIS_PROJECT_DIR || resolve(projectRoot, 'artemis-main'));
  if (!existsSync(resolve(projectDir, 'pyproject.toml'))) {
    console.warn('未找到 Artemis 源码，跳过自动启动。请准备 artemis-main 或设置 ARTEMIS_PROJECT_DIR；主项目继续运行。');
    return;
  }
  console.log(`正在自动启动 Artemis：${localArtemisUrl}`);
  start(resolve(binDir, 'start-artemis.mjs'), [], false);
}

const viteBin = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
// Keep the port fixed so iframe origins match the actual dev server.
start(viteBin, ['--host', '127.0.0.1', '--strictPort', ...args], true);
try {
  await startArtemis();
} catch (error) {
  console.warn(`Artemis 自动启动失败：${error.message}；主项目继续运行。`);
}
